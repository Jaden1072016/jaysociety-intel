import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { accessToken, setConnectionAccount } from "@/providers/oauth";
import * as yt from "@/providers/youtube";
import * as ya from "@/providers/youtubeAnalytics";
import * as tw from "@/providers/twitch";
import { recordFailure, recordSuccess, type FetchLike } from "@/lib/ops";
import { etDate } from "@/lib/time";
import { refreshAccount } from "./creators";

/** The single "Jay Society" self-creator row; created on demand. */
export async function selfCreator() {
  const [c] = await db.select().from(schema.creators).where(eq(schema.creators.isSelf, true));
  if (c) return c;
  const [n] = await db.insert(schema.creators).values({ name: "Jay Society", slug: "jay-society", isSelf: true, priority: 0 }).returning();
  return n;
}

async function upsertSelfAccount(platform: string, handle: string, externalId: string, displayName: string, url: string, followers?: number | null) {
  const me = await selfCreator();
  const [existing] = await db.select().from(schema.creatorAccounts)
    .where(and(eq(schema.creatorAccounts.creatorId, me.id), eq(schema.creatorAccounts.platform, platform)));
  const values = { externalId, displayName, url, verified: true, verifiedAt: new Date(), followerCount: followers ?? null, resolveError: null };
  if (existing) {
    await db.update(schema.creatorAccounts).set({ ...values, handle }).where(eq(schema.creatorAccounts.id, existing.id));
    return existing.id;
  }
  const [row] = await db.insert(schema.creatorAccounts).values({ creatorId: me.id, platform, handle, ...values })
    .onConflictDoUpdate({ target: [schema.creatorAccounts.platform, schema.creatorAccounts.handle], set: { creatorId: me.id, ...values } })
    .returning();
  return row.id;
}

function isoDay(d: Date) { return d.toISOString().slice(0, 10); }

/** Your channel: uploads via Data API (OAuth), per-video + daily metrics via Analytics API. */
export async function syncOwnYouTube(opts: { fetchImpl?: FetchLike } = {}) {
  const token = await accessToken("google", opts.fetchImpl);
  if (!token) return { connected: false as const };
  try {
    const ch = await yt.myChannel(token, opts);
    if (!ch) throw new Error("Connected Google account has no YouTube channel");
    await setConnectionAccount("google", ch.id, ch.title);
    const accId = await upsertSelfAccount("youtube", ch.handle ?? ch.id, ch.id, ch.title, ch.url, ch.subscribers);
    await db.update(schema.creatorAccounts).set({ uploadsPlaylist: ch.uploadsPlaylist }).where(eq(schema.creatorAccounts.id, accId));
    if (process.env.YOUTUBE_API_KEY) await refreshAccount(accId, { ...opts, max: 100 });
    await recordSuccess("youtube_data");

    const end = new Date(Date.now() - 2 * 86400_000); // analytics lag ~2 days
    const start = new Date(end.getTime() - 89 * 86400_000);
    const rows = await ya.perVideo(token, isoDay(start), isoDay(end), opts.fetchImpl);
    let matched = 0;
    for (const r of rows) {
      const [v] = await db.select({ id: schema.videos.id }).from(schema.videos)
        .where(and(eq(schema.videos.platform, "youtube"), eq(schema.videos.externalId, String(r.video))));
      if (!v) continue;
      matched++;
      await db.insert(schema.ownVideoMetrics).values({
        videoId: v.id, views: num(r.views), avgViewDurationSec: num(r.averageViewDuration), avgViewPct: num(r.averageViewPercentage),
        subscribersGained: num(r.subscribersGained), subscribersLost: num(r.subscribersLost),
        likes: num(r.likes), comments: num(r.comments), shares: num(r.shares),
      });
    }
    const days = await ya.daily(token, isoDay(start), isoDay(end), opts.fetchImpl);
    for (const d of days) {
      const metrics = Object.fromEntries(Object.entries(d).filter(([k]) => k !== "day").map(([k, v]) => [k, num(v)]));
      await db.insert(schema.channelDaily).values({ platform: "youtube", date: String(d.day), metrics })
        .onConflictDoUpdate({ target: [schema.channelDaily.platform, schema.channelDaily.date], set: { metrics } });
    }
    await recordSuccess("youtube_analytics", `${matched} videos, ${days.length} days`);
    return { connected: true as const, videos: matched, days: days.length };
  } catch (e) {
    await recordFailure("youtube_analytics", e);
    throw e;
  }
}

/** Your Twitch: followers total (user token) + your VODs through the normal creator pipeline. */
export async function syncOwnTwitch(opts: { fetchImpl?: FetchLike } = {}) {
  const token = await accessToken("twitch", opts.fetchImpl);
  if (!token) return { connected: false as const };
  try {
    const me = await tw.helix<{ id: string; login: string; display_name: string }>("users", [], { ...opts, userToken: token });
    const u = me.data[0];
    if (!u) throw new Error("Twitch token has no user");
    await setConnectionAccount("twitch", u.id, u.display_name);
    const followers = await tw.followerTotal(u.id, token, opts);
    const accId = await upsertSelfAccount("twitch", u.login, u.id, u.display_name, `https://www.twitch.tv/${u.login}`, followers);
    await db.insert(schema.channelDaily).values({ platform: "twitch", date: etDate(), metrics: { followers } })
      .onConflictDoUpdate({ target: [schema.channelDaily.platform, schema.channelDaily.date], set: { metrics: { followers } } });
    if (process.env.TWITCH_CLIENT_ID) await refreshAccount(accId, opts);
    await recordSuccess("twitch_user", `followers ${followers ?? "n/a"}`);
    return { connected: true as const, followers };
  } catch (e) {
    await recordFailure("twitch_user", e);
    throw e;
  }
}

function num(v: unknown): number | null {
  const n = Number(v);
  return v == null || !Number.isFinite(n) ? null : n;
}
