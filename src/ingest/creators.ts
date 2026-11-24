import { and, asc, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import * as yt from "@/providers/youtube";
import * as tw from "@/providers/twitch";
import { computePerformance, type PeerObs } from "@/analysis/performance";
import { extractFormats } from "@/analysis/formats";
import { recordFailure, recordSuccess, ProviderNotConfigured, BudgetExceeded, log, type FetchLike } from "@/lib/ops";

type Opts = { fetchImpl?: FetchLike };

export async function watchedCreatorNames(): Promise<string[]> {
  const rows = await db.select({ name: schema.creators.name }).from(schema.creators)
    .where(and(eq(schema.creators.active, true), eq(schema.creators.isSelf, false)));
  return rows.map((r) => r.name.toLowerCase());
}

/**
 * Look up the account on the platform and record what we found (name, id, followers).
 * Does NOT mark verified: you confirm it's the right person in the UI, because names collide.
 */
export async function resolveAccount(accountId: string, opts: Opts = {}) {
  const [acc] = await db.select().from(schema.creatorAccounts).where(eq(schema.creatorAccounts.id, accountId));
  if (!acc) throw new Error("Account not found");
  try {
    if (acc.platform === "youtube") {
      const ch = await yt.resolveChannel(acc.handle, opts);
      if (!ch) return setResolveError(accountId, `No YouTube channel found for "${acc.handle}"`);
      await db.update(schema.creatorAccounts).set({
        externalId: ch.id, displayName: ch.title, followerCount: ch.subscribers, url: ch.url,
        uploadsPlaylist: ch.uploadsPlaylist, resolveError: null,
      }).where(eq(schema.creatorAccounts.id, accountId));
      await recordSuccess("youtube_data");
      return ch;
    }
    if (acc.platform === "twitch") {
      const u = await tw.resolveUser(acc.handle, opts);
      if (!u) return setResolveError(accountId, `No Twitch user "${acc.handle}"`);
      await db.update(schema.creatorAccounts).set({
        externalId: u.id, displayName: u.displayName, url: u.url, resolveError: null,
      }).where(eq(schema.creatorAccounts.id, accountId));
      await recordSuccess("twitch_helix");
      return u;
    }
    return setResolveError(accountId, `${acc.platform}: no permitted automatic lookup. Add the profile URL and use manual import.`);
  } catch (e) {
    if (e instanceof ProviderNotConfigured) return setResolveError(accountId, e.message);
    await recordFailure(acc.platform === "youtube" ? "youtube_data" : "twitch_helix", e);
    return setResolveError(accountId, (e as Error).message);
  }
}

async function setResolveError(accountId: string, msg: string) {
  await db.update(schema.creatorAccounts).set({ resolveError: msg }).where(eq(schema.creatorAccounts.id, accountId));
  return null;
}

type NormVideo = {
  externalId: string; url: string; title: string; description?: string; publishedAt: Date; durationSec: number | null;
  format: string; thumbnail: string | null; views: number | null; likes?: number | null; comments?: number | null;
};

/** Upsert videos and append a snapshot for each. Returns ids touched. */
export async function storeVideos(
  platform: string, accountId: string | null, list: NormVideo[], opts: { isOwn?: boolean; source?: string; now?: Date } = {},
) {
  const now = opts.now ?? new Date();
  const ids: string[] = [];
  for (const v of list) {
    const formats = extractFormats(v.title, v.description ?? "");
    const [row] = await db.insert(schema.videos).values({
      accountId, platform, externalId: v.externalId, url: v.url, title: v.title, description: v.description ?? null,
      publishedAt: v.publishedAt, durationSec: v.durationSec, format: v.format, thumbnail: v.thumbnail,
      source: opts.source ?? "api", isOwn: opts.isOwn ?? false, formats,
      latestViews: v.views, latestLikes: v.likes ?? null, latestComments: v.comments ?? null, lastSnapshotAt: now,
    }).onConflictDoUpdate({
      target: [schema.videos.platform, schema.videos.externalId],
      set: {
        title: v.title, latestViews: v.views, latestLikes: v.likes ?? null, latestComments: v.comments ?? null,
        lastSnapshotAt: now, formats, format: v.format, durationSec: v.durationSec,
        ...(accountId ? { accountId } : {}), ...(opts.isOwn ? { isOwn: true } : {}),
      },
    }).returning({ id: schema.videos.id });
    ids.push(row.id);
    const ageHours = Math.max(0.01, (now.getTime() - v.publishedAt.getTime()) / 3_600_000);
    await db.insert(schema.videoSnapshots).values({
      videoId: row.id, capturedAt: now, ageHours, views: v.views, likes: v.likes ?? null, comments: v.comments ?? null,
    });
  }
  return ids;
}

/** Pull recent uploads + stats for one verified account and recompute baselines. */
export async function refreshAccount(accountId: string, opts: Opts & { max?: number; now?: Date } = {}) {
  const [acc] = await db.select().from(schema.creatorAccounts).where(eq(schema.creatorAccounts.id, accountId));
  if (!acc || !acc.externalId) throw new Error("Account not resolved yet");
  const [creator] = await db.select().from(schema.creators).where(eq(schema.creators.id, acc.creatorId));
  const isOwn = creator?.isSelf ?? false;
  const provider = acc.platform === "youtube" ? "youtube_data" : "twitch_helix";
  try {
    let stored: string[] = [];
    if (acc.platform === "youtube") {
      let playlist = acc.uploadsPlaylist;
      if (!playlist) {
        const ch = await yt.resolveChannel(acc.externalId, opts);
        playlist = ch?.uploadsPlaylist ?? null;
      }
      if (!playlist) throw new Error("No uploads playlist for channel");
      const ids = await yt.recentUploadIds(playlist, opts.max ?? 50, opts);
      const vids = await yt.getVideos(ids, opts);
      stored = await storeVideos("youtube", accountId, vids, { isOwn, now: opts.now });
    } else if (acc.platform === "twitch") {
      const vids = await tw.userVideos(acc.externalId, opts.max ?? 50, opts);
      stored = await storeVideos("twitch", accountId, vids, { isOwn, now: opts.now });
    } else {
      return { stored: 0 };
    }
    await db.update(schema.creatorAccounts).set({ lastFetchedAt: opts.now ?? new Date() }).where(eq(schema.creatorAccounts.id, accountId));
    await recomputePerformance(accountId, opts.now);
    await recordSuccess(provider);
    return { stored: stored.length };
  } catch (e) {
    await recordFailure(provider, e);
    throw e;
  }
}

/** Recompute perfRatio for every video of an account using its snapshot history. */
export async function recomputePerformance(accountId: string, now = new Date()) {
  const vids = await db.select().from(schema.videos).where(eq(schema.videos.accountId, accountId));
  if (!vids.length) return;
  const snaps = await db.select({
    videoId: schema.videoSnapshots.videoId, ageHours: schema.videoSnapshots.ageHours, views: schema.videoSnapshots.views,
  }).from(schema.videoSnapshots).where(inArray(schema.videoSnapshots.videoId, vids.map((v) => v.id)));
  const fmt = new Map(vids.map((v) => [v.id, v.format]));
  const obs: PeerObs[] = snaps.filter((s) => s.views != null)
    .map((s) => ({ videoId: s.videoId, format: fmt.get(s.videoId) ?? "unknown", ageHours: s.ageHours, views: s.views as number }));
  for (const v of vids) {
    const ageHours = (now.getTime() - v.publishedAt.getTime()) / 3_600_000;
    const p = computePerformance({ id: v.id, format: v.format, ageHours, views: v.latestViews }, obs);
    await db.update(schema.videos).set({ perfRatio: p.ratio, perfConfidence: p.confidence, perfBasis: p.basis })
      .where(eq(schema.videos.id, v.id));
  }
}

/** Refresh every verified account. One provider failing never stops the others. */
export async function refreshAllCreators(opts: Opts & { now?: Date } = {}) {
  const accs = await db.select({ id: schema.creatorAccounts.id, platform: schema.creatorAccounts.platform, handle: schema.creatorAccounts.handle })
    .from(schema.creatorAccounts)
    .innerJoin(schema.creators, eq(schema.creators.id, schema.creatorAccounts.creatorId))
    .where(and(eq(schema.creatorAccounts.verified, true), eq(schema.creators.active, true), isNotNull(schema.creatorAccounts.externalId),
      inArray(schema.creatorAccounts.platform, ["youtube", "twitch"])))
    .orderBy(asc(schema.creators.priority));
  const results: { handle: string; ok: boolean; msg?: string }[] = [];
  const skipPlatforms = new Set<string>();
  for (const a of accs) {
    if (skipPlatforms.has(a.platform)) { results.push({ handle: a.handle, ok: false, msg: "skipped (provider unavailable)" }); continue; }
    try {
      const r = await refreshAccount(a.id, opts);
      results.push({ handle: a.handle, ok: true, msg: `${r.stored} videos` });
    } catch (e) {
      results.push({ handle: a.handle, ok: false, msg: (e as Error).message });
      // Budget or config problems affect the whole provider; stop hammering it this run.
      if (e instanceof BudgetExceeded || e instanceof ProviderNotConfigured) skipPlatforms.add(a.platform);
    }
  }
  if (results.some((r) => !r.ok)) await log("creators", "warn", `Refresh: ${results.filter((r) => !r.ok).length} of ${results.length} accounts failed`);
  return results;
}

/** Recent outperformers across watched creators (evidence for the idea engine). */
export async function recentOutliers(days = 10, minRatio = 1.5, now = new Date()) {
  const since = new Date(now.getTime() - days * 86400_000);
  return db.select({
    id: schema.videos.id, title: schema.videos.title, url: schema.videos.url, platform: schema.videos.platform,
    publishedAt: schema.videos.publishedAt, format: schema.videos.format, formats: schema.videos.formats,
    views: schema.videos.latestViews, perfRatio: schema.videos.perfRatio, perfConfidence: schema.videos.perfConfidence,
    perfBasis: schema.videos.perfBasis, creator: schema.creators.name, creatorId: schema.creators.id,
  }).from(schema.videos)
    .innerJoin(schema.creatorAccounts, eq(schema.creatorAccounts.id, schema.videos.accountId))
    .innerJoin(schema.creators, eq(schema.creators.id, schema.creatorAccounts.creatorId))
    .where(and(gte(schema.videos.publishedAt, since), gte(schema.videos.perfRatio, minRatio), eq(schema.creators.isSelf, false),
      inArray(schema.videos.perfConfidence, ["high", "medium", "low"])))
    .orderBy(desc(schema.videos.perfRatio))
    .limit(40);
}

/** New uploads since a time, for the "new from watched creators" panel. */
export async function newUploads(sinceHours = 36, now = new Date()) {
  const since = new Date(now.getTime() - sinceHours * 3_600_000);
  return db.select({
    id: schema.videos.id, title: schema.videos.title, url: schema.videos.url, platform: schema.videos.platform,
    publishedAt: schema.videos.publishedAt, format: schema.videos.format, views: schema.videos.latestViews,
    perfRatio: schema.videos.perfRatio, perfConfidence: schema.videos.perfConfidence, creator: schema.creators.name,
  }).from(schema.videos)
    .innerJoin(schema.creatorAccounts, eq(schema.creatorAccounts.id, schema.videos.accountId))
    .innerJoin(schema.creators, eq(schema.creators.id, schema.creatorAccounts.creatorId))
    .where(and(gte(schema.videos.publishedAt, since), eq(schema.creators.isSelf, false)))
    .orderBy(desc(schema.videos.publishedAt)).limit(30);
}

export async function liveNow(opts: Opts = {}) {
  const accs = await db.select({ externalId: schema.creatorAccounts.externalId, name: schema.creators.name })
    .from(schema.creatorAccounts).innerJoin(schema.creators, eq(schema.creators.id, schema.creatorAccounts.creatorId))
    .where(and(eq(schema.creatorAccounts.platform, "twitch"), eq(schema.creatorAccounts.verified, true), isNotNull(schema.creatorAccounts.externalId)));
  if (!accs.length) return [];
  const streams = await tw.liveStreams(accs.map((a) => a.externalId!), opts);
  return streams.map((s) => ({ ...s, name: accs.find((a) => a.externalId === s.user_id)?.name ?? s.user_login }));
}
