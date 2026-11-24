import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSetting } from "@/lib/settings";
import { createId } from "@/lib/id";
import { recentRelevantTrends } from "@/ingest/trends";
import { recentOutliers } from "@/ingest/creators";
import { formatLift } from "@/analysis/formats";
import { buildCandidates, formatCandidates, type Candidate } from "./candidates";
import { claudeIdeas, type ClaudeClient } from "./claude";
import { rulesIdea, whyFits, type GeneratedIdea } from "./rules";
import { evidenceStrength, finalizeScores, totalScore } from "./scoring";

/** Cross-creator format patterns from the last 60 days of watched-creator videos. */
async function formatPatterns(now: Date) {
  const since = new Date(now.getTime() - 60 * 86400_000);
  const rows = await db.select({
    creator: schema.creators.name, formats: schema.videos.formats, perfRatio: schema.videos.perfRatio,
    title: schema.videos.title, url: schema.videos.url,
  }).from(schema.videos)
    .innerJoin(schema.creatorAccounts, eq(schema.creatorAccounts.id, schema.videos.accountId))
    .innerJoin(schema.creators, eq(schema.creators.id, schema.creatorAccounts.creatorId))
    .where(and(gte(schema.videos.publishedAt, since), eq(schema.creators.isSelf, false)));
  const byCreator = new Map<string, typeof rows>();
  for (const r of rows) byCreator.set(r.creator, [...(byCreator.get(r.creator) ?? []), r]);
  const out: Parameters<typeof formatCandidates>[0] = [];
  for (const [creator, vids] of byCreator) {
    for (const f of formatLift(vids).slice(0, 2)) {
      const examples = vids.filter((v) => v.formats.includes(f.format) && (v.perfRatio ?? 0) >= 1.5).slice(0, 2).map((v) => ({ title: v.title, url: v.url }));
      out.push({ creator, ...f, examples });
    }
  }
  return out;
}

export async function gatherCandidates(now = new Date()): Promise<Candidate[]> {
  const trends = await recentRelevantTrends(48, 0.25, now);
  const outliers = await recentOutliers(10, 1.5, now);
  const since = new Date(now.getTime() - 7 * 86400_000);
  const recentTitles = await db.select({ creator: schema.creators.name, title: schema.videos.title }).from(schema.videos)
    .innerJoin(schema.creatorAccounts, eq(schema.creatorAccounts.id, schema.videos.accountId))
    .innerJoin(schema.creators, eq(schema.creators.id, schema.creatorAccounts.creatorId))
    .where(and(gte(schema.videos.publishedAt, since), eq(schema.creators.isSelf, false)));
  const [tw] = await db.select({ since: sql<Date | null>`min(${schema.trends.firstSeenAt})` }).from(schema.trends).where(eq(schema.trends.source, "twitch_top"));
  const twitchSince = tw?.since ? new Date(tw.since) : null;
  const cands = buildCandidates(trends.map((t) => ({ ...t, news: t.news ?? [] })), outliers, recentTitles, now, twitchSince);
  const fmts = formatCandidates(await formatPatterns(now));
  return [...cands, ...fmts].sort((a, b) => b.preScore - a.preScore);
}

/** Topics already suggested recently (and not dismissed) are skipped to avoid duplicate cards. */
async function recentTopicKeys(hours: number, now: Date): Promise<Set<string>> {
  const since = new Date(now.getTime() - hours * 3_600_000);
  const rows = await db.select({ k: schema.opportunities.topicKey }).from(schema.opportunities)
    .where(and(gte(schema.opportunities.createdAt, since), ne(schema.opportunities.status, "dismissed")));
  return new Set(rows.map((r) => r.k));
}

export type GenerateResult = { batchId: string; created: number; generator: "claude" | "rules" | "mixed" | "none"; ids: string[] };

export async function generateOpportunities(opts: { now?: Date; client?: ClaudeClient; max?: number } = {}): Promise<GenerateResult> {
  const now = opts.now ?? new Date();
  const ai = await getSetting("ai");
  const profile = await getSetting("audience_profile");
  const skip = await recentTopicKeys(72, now);
  const cands = (await gatherCandidates(now)).filter((c) => !skip.has(c.topicKey)).slice(0, opts.max ?? ai.maxIdeasPerRun);
  const batchId = createId();
  if (!cands.length) return { batchId, created: 0, generator: "none", ids: [] };

  const fromClaude = await claudeIdeas(cands, profile, ai, opts.client);
  const byKey = new Map((fromClaude ?? []).map((i) => [i.topicKey, i]));
  const ids: string[] = [];
  let usedClaude = 0, usedRules = 0;
  for (const c of cands) {
    let idea: GeneratedIdea | undefined = byKey.get(c.topicKey);
    const generator = idea ? "claude" : "rules";
    if (!idea) idea = rulesIdea(c);
    generator === "claude" ? usedClaude++ : usedRules++;
    const scores = finalizeScores(
      { audienceRelevance: c.relevance * 10, freshness: c.freshness * 10, evidenceStrength: evidenceStrength(c.signals) },
      { feasibility: idea.feasibility, originality: idea.originality, collaboration: idea.collaboration },
      c.saturation,
    );
    const [row] = await db.insert(schema.opportunities).values({
      batchId, topic: c.topic, topicKey: c.topicKey, title: idea.title, hook: idea.hook, concept: idea.concept,
      livestream: idea.livestream, clips: idea.clips, platforms: idea.platforms, production: idea.production,
      // whyFits from the generator is AI text; prepend the measured reasons so evidence and opinion stay separable.
      whyFits: generator === "claude" ? `${whyFits(c)} ${idea.whyFits}`.trim() : idea.whyFits,
      evidence: c.evidence, aiNotes: idea.aiNotes, generator, scores, totalScore: totalScore(scores), createdAt: now,
    }).returning({ id: schema.opportunities.id });
    ids.push(row.id);
  }
  return { batchId, created: ids.length, generator: usedClaude && usedRules ? "mixed" : usedClaude ? "claude" : "rules", ids };
}

export async function topOpportunities(limit = 8, sinceHours = 36, now = new Date()) {
  const since = new Date(now.getTime() - sinceHours * 3_600_000);
  return db.select().from(schema.opportunities)
    .where(and(gte(schema.opportunities.createdAt, since), inArray(schema.opportunities.status, ["new", "saved"])))
    .orderBy(desc(schema.opportunities.totalScore)).limit(limit);
}
