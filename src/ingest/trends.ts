import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { fetchTrends, type RawTrend } from "@/providers/googleTrends";
import { topCategories } from "@/providers/twitch";
import { clusterTitles, normalizeKey } from "@/analysis/normalize";
import { scoreRelevance } from "@/analysis/relevance";
import { getSetting } from "@/lib/settings";
import { recordFailure, recordSuccess, type FetchLike } from "@/lib/ops";
import { watchedCreatorNames } from "./creators";

export type UpsertTrend = {
  source: string; title: string; url?: string | null; approxTraffic?: string | null; trafficNum?: number | null;
  publishedAt?: Date | null; news?: { title: string; url: string; source?: string }[]; supportLevel?: string;
};

/** Insert or refresh trends. Same (source, normalized title) = same row; seenCount tracks persistence. */
export async function upsertTrends(items: UpsertTrend[], now = new Date()) {
  const profile = await getSetting("audience_profile");
  const creators = await watchedCreatorNames();
  let inserted = 0, updated = 0;
  const seen = new Set<string>();
  for (const it of items) {
    const key = normalizeKey(it.title);
    if (!key || seen.has(`${it.source}|${key}`)) continue; // dedupe within the batch
    seen.add(`${it.source}|${key}`);
    const text = [it.title, ...(it.news ?? []).map((n) => n.title)].join(" \n ");
    const rel = scoreRelevance(text, profile, creators);
    const res = await db.insert(schema.trends).values({
      source: it.source, key, title: it.title, url: it.url ?? null, approxTraffic: it.approxTraffic ?? null,
      trafficNum: it.trafficNum ?? null, publishedAt: it.publishedAt ?? null, news: it.news ?? [],
      relevance: rel.score, matchedTopics: rel.matched, supportLevel: it.supportLevel ?? "full",
      firstSeenAt: now, lastSeenAt: now,
    }).onConflictDoUpdate({
      target: [schema.trends.source, schema.trends.key],
      set: {
        lastSeenAt: now, seenCount: sql`${schema.trends.seenCount} + 1`,
        approxTraffic: it.approxTraffic ?? sql`${schema.trends.approxTraffic}`,
        trafficNum: it.trafficNum ?? sql`${schema.trends.trafficNum}`,
        news: it.news?.length ? it.news : sql`${schema.trends.news}`,
        relevance: rel.score, matchedTopics: rel.matched,
      },
    }).returning({ seenCount: schema.trends.seenCount });
    if (res[0]?.seenCount === 1) inserted++; else updated++;
  }
  await recluster(now);
  return { inserted, updated };
}

/** Assign cluster keys across all sources for the last 72h so overlapping topics group together. */
export async function recluster(now = new Date()) {
  const since = new Date(now.getTime() - 72 * 3_600_000);
  const rows = await db.select({ id: schema.trends.id, title: schema.trends.title, trafficNum: schema.trends.trafficNum })
    .from(schema.trends).where(gte(schema.trends.lastSeenAt, since))
    .orderBy(sql`${schema.trends.trafficNum} desc nulls last`);
  const clusters = clusterTitles(rows.map((r) => r.title));
  for (let i = 0; i < rows.length; i++) {
    await db.update(schema.trends).set({ clusterKey: clusters[i] }).where(eq(schema.trends.id, rows[i].id));
  }
}

export async function ingestGoogleTrends(opts: { fetchImpl?: FetchLike; raw?: RawTrend[] } = {}) {
  try {
    const raw = opts.raw ?? await fetchTrends("US", opts.fetchImpl);
    if (!raw.length) throw new Error("Trends RSS returned 0 items");
    const r = await upsertTrends(raw.map((t) => ({ source: "google_trends_rss", ...t })));
    await recordSuccess("google_trends_rss", `${raw.length} items`);
    return r;
  } catch (e) {
    await recordFailure("google_trends_rss", e);
    throw e;
  }
}

export async function ingestTwitchTop(opts: { fetchImpl?: FetchLike } = {}) {
  try {
    const cats = await topCategories(30, opts);
    const r = await upsertTrends(cats.map((c, i) => ({
      source: "twitch_top", title: c.name, url: `https://www.twitch.tv/directory/category/${encodeURIComponent(c.name.toLowerCase().replace(/\s+/g, "-"))}`,
      approxTraffic: `#${i + 1} on Twitch`, trafficNum: null,
    })));
    await recordSuccess("twitch_helix");
    return r;
  } catch (e) {
    await recordFailure("twitch_helix", e);
    throw e;
  }
}

export async function recentRelevantTrends(hours = 48, minRelevance = 0.2, now = new Date()) {
  const since = new Date(now.getTime() - hours * 3_600_000);
  return db.select().from(schema.trends)
    .where(and(gte(schema.trends.lastSeenAt, since), gte(schema.trends.relevance, minRelevance), eq(schema.trends.dismissed, false)))
    .orderBy(sql`${schema.trends.relevance} desc, ${schema.trends.lastSeenAt} desc`)
    .limit(80);
}
