import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { etDate } from "@/lib/time";
import { newUploads, recentOutliers } from "@/ingest/creators";
import { recentRelevantTrends } from "@/ingest/trends";
import { topOpportunities } from "./generate";
import { postingStrategy } from "./review";

export type BriefingContent = {
  date: string;
  generatedAt: string;
  opportunityIds: string[];
  headline: string;
  trends: { title: string; source: string; relevance: number; url: string | null; approxTraffic: string | null }[];
  uploads: { creator: string; title: string; url: string; platform: string; publishedAt: string }[];
  outliers: { creator: string; title: string; url: string; perfRatio: number | null; perfConfidence: string | null }[];
  pipeline: Record<string, number>;
  posting: { headline: string; basis: string };
  health: { provider: string; ok: boolean; lastSuccessAt: string | null; lastError: string | null }[];
};

export async function buildBriefing(now = new Date()): Promise<BriefingContent> {
  const opps = await topOpportunities(5, 24, now);
  const trends = (await recentRelevantTrends(24, 0.3, now)).slice(0, 6);
  const uploads = await newUploads(24, now);
  const outliers = (await recentOutliers(5, 1.5, now)).slice(0, 5);
  const pipelineRows = await db.select({ status: schema.ideas.status, n: sql<number>`count(*)::int` }).from(schema.ideas).groupBy(schema.ideas.status);
  const health = await db.select().from(schema.providerStatus);
  const posting = await postingStrategy(now);
  const headline = opps.length
    ? `${opps.length} opportunities today. Top: ${opps[0].title}`
    : "No strong new opportunities today. Check the trends list or import research.";
  return {
    date: etDate(now), generatedAt: now.toISOString(), opportunityIds: opps.map((o) => o.id), headline,
    trends: trends.map((t) => ({ title: t.title, source: t.source, relevance: t.relevance, url: t.url, approxTraffic: t.approxTraffic })),
    uploads: uploads.slice(0, 10).map((u) => ({ creator: u.creator, title: u.title, url: u.url, platform: u.platform, publishedAt: u.publishedAt.toISOString() })),
    outliers: outliers.map((o) => ({ creator: o.creator, title: o.title, url: o.url, perfRatio: o.perfRatio, perfConfidence: o.perfConfidence })),
    pipeline: Object.fromEntries(pipelineRows.map((r) => [r.status, r.n])),
    posting: { headline: posting.headline, basis: posting.basis },
    health: health.filter((h) => h.lastSuccessAt || h.lastErrorAt).map((h) => ({
      provider: h.provider, ok: h.consecutiveFailures === 0, lastSuccessAt: h.lastSuccessAt?.toISOString() ?? null, lastError: h.consecutiveFailures ? h.lastError : null,
    })),
  };
}

export async function saveBriefing(content: BriefingContent) {
  await db.insert(schema.briefings).values({ date: content.date, content })
    .onConflictDoUpdate({ target: schema.briefings.date, set: { content, createdAt: new Date() } });
}

export async function getBriefing(date: string) {
  const [b] = await db.select().from(schema.briefings).where(eq(schema.briefings.date, date));
  return b ? { ...b, content: b.content as BriefingContent } : null;
}
