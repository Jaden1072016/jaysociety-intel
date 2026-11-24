import { zonedParts, hourLabel, weekdayName } from "@/lib/time";
import { median } from "./performance";

/**
 * Posting-window analysis. We only ever describe association, never causation:
 * a big video posted at 6 PM doesn't mean 6 PM caused it.
 *
 * Own data is the primary signal (performance vs your own median, by ET hour block).
 * Creator benchmarks are secondary and only say when those creators tend to post.
 */

export type PostObs = { publishedAt: Date; perfRatio?: number | null; views?: number | null };
export type WindowStat = { block: string; posts: number; medianRatio: number | null };

export const BLOCKS = [
  { id: "late_night", label: "12–6 AM", from: 0, to: 6 },
  { id: "morning", label: "6–11 AM", from: 6, to: 11 },
  { id: "midday", label: "11 AM–3 PM", from: 11, to: 15 },
  { id: "afternoon", label: "3–6 PM", from: 15, to: 18 },
  { id: "evening", label: "6–9 PM", from: 18, to: 21 },
  { id: "night", label: "9 PM–12 AM", from: 21, to: 24 },
];

export function blockOf(d: Date): (typeof BLOCKS)[number] {
  const h = zonedParts(d).hour;
  return BLOCKS.find((b) => h >= b.from && h < b.to)!;
}

export function windowStats(posts: PostObs[]): WindowStat[] {
  return BLOCKS.map((b) => {
    const inB = posts.filter((p) => blockOf(p.publishedAt).id === b.id);
    const ratios = inB.map((p) => p.perfRatio).filter((x): x is number => x != null);
    return { block: b.label, posts: inB.length, medianRatio: ratios.length ? Math.round(median(ratios)! * 100) / 100 : null };
  });
}

export type PostingAdvice = {
  basis: "own" | "benchmark" | "insufficient";
  headline: string;
  detail: string[];
  caveat: string;
  stats: WindowStat[];
};

export const CAVEAT =
  "Timing patterns show association only. Topic, title, thumbnail and luck matter more than the clock. Treat any window as a test, not a rule.";

export function postingAdvice(own: PostObs[], benchmark: PostObs[], minOwnPosts = 12): PostingAdvice {
  const ownWithRatio = own.filter((p) => p.perfRatio != null);
  if (ownWithRatio.length >= minOwnPosts) {
    const stats = windowStats(ownWithRatio);
    const eligible = stats.filter((s) => s.posts >= 3 && s.medianRatio != null).sort((a, b) => b.medianRatio! - a.medianRatio!);
    if (eligible.length >= 2) {
      const best = eligible[0], next = eligible[1];
      return {
        basis: "own",
        headline: `Your posts in the ${best.block} ET window have done best so far`,
        detail: [
          `${best.block}: median ${best.medianRatio}x your usual across ${best.posts} posts.`,
          `${next.block}: median ${next.medianRatio}x across ${next.posts} posts.`,
          `Run an experiment comparing these two windows with similar content before locking anything in.`,
        ],
        caveat: CAVEAT, stats,
      };
    }
  }
  if (benchmark.length >= 20) {
    const stats = windowStats(benchmark);
    const top = [...stats].sort((a, b) => b.posts - a.posts).slice(0, 2);
    const days = new Map<number, number>();
    for (const p of benchmark) { const w = zonedParts(p.publishedAt).weekday; days.set(w, (days.get(w) ?? 0) + 1); }
    const topDay = [...days].sort((a, b) => b[1] - a[1])[0];
    return {
      basis: "benchmark",
      headline: `Not enough of your own data yet. Watched creators post most in ${top[0].block} ET`,
      detail: [
        `${top[0].block}: ${top[0].posts} of ${benchmark.length} recent uploads. ${top[1].block}: ${top[1].posts}.`,
        topDay ? `Most common upload day: ${weekdayName(topDay[0])}.` : "",
        `This is when they post, not proof it works better. Connect YouTube and log ${minOwnPosts}+ of your posts to get advice from your own results.`,
      ].filter(Boolean),
      caveat: CAVEAT, stats,
    };
  }
  return {
    basis: "insufficient", headline: "Not enough data for a posting window yet",
    detail: [`Need ${minOwnPosts}+ of your posts with results, or 20+ creator uploads.`], caveat: CAVEAT, stats: windowStats([]),
  };
}

export { hourLabel };
