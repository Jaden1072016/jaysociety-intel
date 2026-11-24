import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { median } from "@/analysis/performance";
import { formatLabel } from "@/analysis/formats";
import { postingAdvice } from "@/analysis/posting";

export type FormatVerdict = "Keep investing" | "Promising, test more" | "Deprioritize" | "Not enough data";

export type FormatRow = {
  format: string; label: string; posts: number; medianViews: number | null; medianRatio: number | null;
  subsPer1kViews: number | null; avgViewPct: number | null; verdict: FormatVerdict; source: string;
};

/** Verdict rules are deliberately simple and visible in the UI. */
export function verdictFor(posts: number, medianRatio: number | null, subsPer1k: number | null, overallSubsPer1k: number | null): FormatVerdict {
  if (posts < 2 || medianRatio == null) return "Not enough data";
  const converts = subsPer1k != null && overallSubsPer1k != null && subsPer1k >= overallSubsPer1k;
  if (medianRatio >= 1.2 || (medianRatio >= 0.9 && converts)) return posts >= 4 ? "Keep investing" : "Promising, test more";
  if (medianRatio < 0.7 && !converts) return "Deprioritize";
  return "Promising, test more";
}

/** Your own videos grouped by detected content format (YouTube analytics if connected, else public counts). */
export async function ownFormatReview(days = 90, now = new Date()): Promise<{ rows: FormatRow[]; note: string }> {
  const since = new Date(now.getTime() - days * 86400_000);
  const vids = await db.select().from(schema.videos)
    .where(and(eq(schema.videos.isOwn, true), gte(schema.videos.publishedAt, since)));
  if (!vids.length) return { rows: [], note: "No videos from your connected accounts yet. Connect YouTube/Twitch in Settings, or log results on published ideas." };
  const metrics = await db.select().from(schema.ownVideoMetrics)
    .where(inArray(schema.ownVideoMetrics.videoId, vids.map((v) => v.id))).orderBy(desc(schema.ownVideoMetrics.fetchedAt));
  const latest = new Map<string, (typeof metrics)[number]>();
  for (const m of metrics) if (!latest.has(m.videoId)) latest.set(m.videoId, m);

  const perVideoSubs = (v: (typeof vids)[number]) => {
    const m = latest.get(v.id);
    return m?.subscribersGained != null && m.views ? (m.subscribersGained / m.views) * 1000 : null;
  };
  const overallSubs = median(vids.map(perVideoSubs).filter((x): x is number => x != null));

  const groups = new Map<string, typeof vids>();
  for (const v of vids) {
    const keys = [`type:${v.format}`, ...v.formats.filter((f) => !["caps_hook", "question_title"].includes(f))];
    for (const k of keys) groups.set(k, [...(groups.get(k) ?? []), v]);
  }
  const rows: FormatRow[] = [...groups].map(([k, vs]) => {
    const ratios = vs.map((v) => v.perfRatio).filter((x): x is number => x != null);
    const subs = vs.map(perVideoSubs).filter((x): x is number => x != null);
    const pct = vs.map((v) => latest.get(v.id)?.avgViewPct).filter((x): x is number => x != null);
    const medRatio = ratios.length ? Math.round(median(ratios)! * 100) / 100 : null;
    const subsMed = subs.length ? Math.round(median(subs)! * 100) / 100 : null;
    return {
      format: k, label: k.startsWith("type:") ? `${k.slice(5).replace("_", " ")} (video type)` : formatLabel(k),
      posts: vs.length, medianViews: median(vs.map((v) => v.latestViews ?? 0)), medianRatio: medRatio,
      subsPer1kViews: subsMed, avgViewPct: pct.length ? Math.round(median(pct)! * 10) / 10 : null,
      verdict: verdictFor(vs.length, medRatio, subsMed, overallSubs),
      source: latest.size ? "YouTube Analytics + public counts" : "Public counts only",
    };
  }).sort((a, b) => (b.medianRatio ?? -1) - (a.medianRatio ?? -1));
  return { rows, note: latest.size ? "Subs per 1k views = subscribers gained on that video's watch page per 1,000 views. Returning viewers per video are not available from the API." : "Connect YouTube Analytics to see watch time and subscriber conversion." };
}

/** Ideas you published and logged results for, grouped by your own format label. */
export async function ideaFormatReview() {
  const rows = await db.select().from(schema.ideas)
    .where(and(inArray(schema.ideas.status, ["Published", "Reviewed"]), isNotNull(schema.ideas.results)));
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = r.format || "Unlabeled";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups].map(([format, rs]) => ({
    format, posts: rs.length,
    medianViews: median(rs.map((r) => r.results?.views).filter((x): x is number => x != null)),
    medianFollows: median(rs.map((r) => r.results?.follows).filter((x): x is number => x != null)),
  })).sort((a, b) => (b.medianViews ?? 0) - (a.medianViews ?? 0));
}

export async function experimentResults() {
  const exps = await db.select().from(schema.experiments).orderBy(desc(schema.experiments.createdAt));
  const out = [];
  for (const e of exps) {
    const ideas = await db.select().from(schema.ideas).where(eq(schema.ideas.experimentId, e.id));
    const arm = (a: string) => {
      const rs = ideas.filter((i) => i.experimentArm === a);
      const views = rs.map((r) => r.results?.views).filter((x): x is number => x != null);
      const follows = rs.map((r) => r.results?.follows).filter((x): x is number => x != null);
      return { arm: a, posts: rs.length, withResults: views.length, medianViews: median(views), medianFollows: median(follows) };
    };
    const A = arm("A"), B = arm("B");
    const enough = A.withResults >= 3 && B.withResults >= 3;
    let readout = "Need at least 3 posts with results in each arm before reading anything into it.";
    if (enough && A.medianViews != null && B.medianViews != null) {
      const lead = A.medianViews >= B.medianViews ? A : B, other = lead === A ? B : A;
      const diff = other.medianViews ? Math.round((lead.medianViews! / other.medianViews - 1) * 100) : null;
      readout = `${lead.arm === "A" ? e.armA : e.armB} leads on median views${diff != null ? ` by ${diff}%` : ""}. Small samples swing a lot; keep running before deciding.`;
    }
    out.push({ ...e, A, B, readout });
  }
  return out;
}

export async function postingStrategy(now = new Date()) {
  const since = new Date(now.getTime() - 120 * 86400_000);
  const own = await db.select({ publishedAt: schema.videos.publishedAt, perfRatio: schema.videos.perfRatio })
    .from(schema.videos).where(and(eq(schema.videos.isOwn, true), gte(schema.videos.publishedAt, since)));
  const bench = await db.select({ publishedAt: schema.videos.publishedAt }).from(schema.videos)
    .innerJoin(schema.creatorAccounts, eq(schema.creatorAccounts.id, schema.videos.accountId))
    .innerJoin(schema.creators, eq(schema.creators.id, schema.creatorAccounts.creatorId))
    .where(and(eq(schema.videos.isOwn, false), eq(schema.creators.isSelf, false), gte(schema.videos.publishedAt, new Date(now.getTime() - 45 * 86400_000))));
  return postingAdvice(own, bench);
}
