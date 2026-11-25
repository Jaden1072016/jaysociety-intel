import { and, eq, gte, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { analyzeTiming, type Kind, type TimingPost } from "@/analysis/timing";
import { postingStrategy } from "./review";

/** Creator posts from the last 60 days with their cohort tag. */
export async function timingPosts(now = new Date()): Promise<TimingPost[]> {
  const since = new Date(now.getTime() - 60 * 86400_000);
  const rows = await db.select({
    creator: schema.creators.name, tags: schema.creators.tags, platform: schema.videos.platform, format: schema.videos.format,
    publishedAt: schema.videos.publishedAt, perfRatio: schema.videos.perfRatio, perfConfidence: schema.videos.perfConfidence,
  }).from(schema.videos)
    .innerJoin(schema.creatorAccounts, eq(schema.creatorAccounts.id, schema.videos.accountId))
    .innerJoin(schema.creators, eq(schema.creators.id, schema.creatorAccounts.creatorId))
    .where(and(gte(schema.videos.publishedAt, since), eq(schema.creators.isSelf, false), eq(schema.creatorAccounts.verified, true), isNotNull(schema.videos.accountId)));
  return rows.map((r) => ({ ...r, cohort: r.tags.find((t) => ["Core", "Large", "Mid-size", "Emerging"].includes(t)) ?? "Core" }));
}

export async function timingReport(now = new Date()) {
  const posts = await timingPosts(now);
  const kinds: Kind[] = ["go_live", "youtube_upload", "shorts"];
  return { creators: kinds.map((k) => analyzeTiming(posts, k)), own: await postingStrategy(now) };
}
