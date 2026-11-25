import { zonedParts } from "@/lib/time";
import { BLOCKS, blockOf } from "./posting";
import { median } from "./performance";

/**
 * Cross-creator timing patterns. Two separate questions:
 *  1. When do creators cluster?  Each creator's own posting share is averaged, so one prolific
 *     creator can't dominate (a creator posting 40 times counts the same as one posting 5).
 *  2. Which windows outperform?  Uses each post's ratio vs that creator's OWN age- and format-matched
 *     usual, so a Kai Cenat upload isn't "better" just because he's bigger. Gated by sample size.
 * Everything here is association, not proof a time causes results.
 */

export type TimingPost = {
  creator: string; cohort: string | null; platform: string; format: string;
  publishedAt: Date; perfRatio: number | null; perfConfidence: string | null;
};

export type Kind = "go_live" | "youtube_upload" | "shorts";
export const KIND_LABEL: Record<Kind, string> = { go_live: "Going live", youtube_upload: "YouTube uploads", shorts: "Shorts" };

export function kindOf(p: Pick<TimingPost, "platform" | "format">): Kind | null {
  if (p.platform === "twitch" && p.format === "live_vod") return "go_live"; // archive VOD time = stream start
  if (p.platform === "youtube" && p.format === "short") return "shorts";
  if (p.platform === "youtube" && (p.format === "long" || p.format === "live_vod")) return "youtube_upload";
  return null;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const COHORT_WEIGHT: Record<string, number> = { Emerging: 1.5, "Mid-size": 1.5, Core: 1, Large: 0.75 };

export type BlockStat = {
  block: string; creatorShare: number; creators: number; posts: number;
  medianRatio: number | null; ratedPosts: number; ratedCreators: number;
};

export type TimingResult = {
  kind: Kind; posts: number; creators: number;
  blocks: BlockStat[];
  topDays: { day: string; share: number }[];
  pick: { block: string; reason: string; confidence: "provisional" | "usable" } | null;
  note: string;
};

export const MIN_RATED_POSTS = 10;
export const MIN_RATED_CREATORS = 3;

export function analyzeTiming(all: TimingPost[], kind: Kind): TimingResult {
  const posts = all.filter((p) => kindOf(p) === kind);
  const byCreator = new Map<string, TimingPost[]>();
  for (const p of posts) byCreator.set(p.creator, [...(byCreator.get(p.creator) ?? []), p]);
  // Ignore creators with too few posts of this kind to have a pattern.
  const creators = [...byCreator].filter(([, ps]) => ps.length >= 3);
  const totalWeight = creators.reduce((s, [, ps]) => s + (COHORT_WEIGHT[ps[0].cohort ?? "Core"] ?? 1), 0);

  const blocks: BlockStat[] = BLOCKS.map((b) => {
    let share = 0, nCreators = 0, nPosts = 0;
    for (const [, ps] of creators) {
      const inB = ps.filter((p) => blockOf(p.publishedAt).id === b.id).length;
      const w = COHORT_WEIGHT[ps[0].cohort ?? "Core"] ?? 1;
      share += (inB / ps.length) * w;
      if (inB) nCreators++;
      nPosts += inB;
    }
    const rated = creators.flatMap(([, ps]) => ps).filter((p) => blockOf(p.publishedAt).id === b.id && p.perfRatio != null && (p.perfConfidence === "medium" || p.perfConfidence === "high"));
    const ratedCreators = new Set(rated.map((p) => p.creator)).size;
    const enough = rated.length >= MIN_RATED_POSTS && ratedCreators >= MIN_RATED_CREATORS;
    return {
      block: b.label, creatorShare: totalWeight ? Math.round((share / totalWeight) * 1000) / 10 : 0,
      creators: nCreators, posts: nPosts,
      medianRatio: enough ? Math.round(median(rated.map((p) => p.perfRatio as number))! * 100) / 100 : null,
      ratedPosts: rated.length, ratedCreators,
    };
  });

  const dayShare = new Map<number, number>();
  for (const [, ps] of creators) {
    const w = COHORT_WEIGHT[ps[0].cohort ?? "Core"] ?? 1;
    for (const p of ps) dayShare.set(zonedParts(p.publishedAt).weekday, (dayShare.get(zonedParts(p.publishedAt).weekday) ?? 0) + (w / ps.length));
  }
  const topDays = [...dayShare].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([d, s]) => ({ day: DAYS[d], share: totalWeight ? Math.round((s / totalWeight) * 1000) / 10 : 0 }));

  // Pick: among blocks where at least a quarter of creators are active, prefer measured outperformance;
  // if no block has enough rated posts yet, fall back to the strongest cluster and say so.
  const busy = blocks.filter((b) => b.creators >= Math.max(2, Math.ceil(creators.length / 4)));
  const measured = busy.filter((b) => b.medianRatio != null).sort((a, b) => b.medianRatio! - a.medianRatio!);
  let pick: TimingResult["pick"] = null;
  if (measured.length && measured[0].medianRatio! >= 1) {
    const m = measured[0];
    pick = {
      block: m.block, confidence: m.ratedPosts >= 25 ? "usable" : "provisional",
      reason: `${m.creators} creators post here and these posts ran ${m.medianRatio}x their own usual (median of ${m.ratedPosts} posts from ${m.ratedCreators} creators).`,
    };
  } else if (busy.length) {
    const c = [...busy].sort((a, b) => b.creatorShare - a.creatorShare)[0];
    pick = {
      block: c.block, confidence: "provisional",
      reason: `Most common window (${c.creatorShare}% of creator activity, ${c.creators} creators). Not enough rated posts yet to say it performs better.`,
    };
  }
  return {
    kind, posts: posts.length, creators: creators.length, blocks, topDays, pick,
    note: creators.length < 3 ? "Fewer than 3 creators with enough posts of this type yet." : "Pattern across creators you watch, weighted toward mid-size and emerging. A starting point to test, not proof.",
  };
}
