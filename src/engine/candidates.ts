import type { Evidence } from "@/db/schema";
import { jaccard, normalizeKey, tokens } from "@/analysis/normalize";
import { freshness } from "@/analysis/freshness";
import { formatLabel, titleHook } from "@/analysis/formats";
import { evidenceStrength, type EvidenceSignals } from "./scoring";

export type TrendRow = {
  id: string; source: string; title: string; url: string | null; approxTraffic: string | null; trafficNum: number | null;
  firstSeenAt: Date; lastSeenAt: Date; relevance: number; matchedTopics: string[]; clusterKey: string | null;
  news: { title: string; url: string; source?: string }[] | null; supportLevel: string;
};

export type OutlierRow = {
  id: string; title: string; url: string; platform: string; publishedAt: Date; format: string; formats: string[];
  views: number | null; perfRatio: number | null; perfConfidence: string | null; perfBasis: string | null; creator: string;
};

export type Candidate = {
  topic: string;
  topicKey: string;
  kind: "trend" | "creator_outlier" | "format_pattern";
  evidence: Evidence[];
  matched: string[];
  relevance: number; // 0..1
  freshness: number; // 0..1
  signals: EvidenceSignals;
  saturation: number; // how many watched creators already covered it recently
  creators: string[];
  formats: string[];
  preScore: number; // for picking which candidates to send to the generator
};

const SOURCE_LABEL: Record<string, string> = {
  google_trends_rss: "Google Trends",
  twitch_top: "Twitch top categories",
  manual_tiktok_cc: "TikTok Creative Center (you imported)",
  manual_tiktok_search: "TikTok Search Insights (you imported)",
  manual_yt_trends: "YouTube Studio Trends (you imported)",
  manual_instagram: "Instagram (you imported)",
  manual_x: "X (you imported)",
  manual_other: "Manual import",
};

function confRank(c: string | null | undefined): number {
  return c === "high" ? 3 : c === "medium" ? 2 : c === "low" ? 1 : 0;
}
const RANK_CONF = ["none", "low", "medium", "high"] as const;

/**
 * Build idea candidates from evidence. Trends are grouped by cluster; creator outliers attach
 * to a trend cluster when their titles overlap (cross-source agreement = stronger evidence),
 * otherwise they become their own candidate. Pure function: easy to test.
 */
export function buildCandidates(trends: TrendRow[], outliers: OutlierRow[], recentCreatorTitles: { creator: string; title: string }[], now = new Date()): Candidate[] {
  const byCluster = new Map<string, TrendRow[]>();
  for (const t of trends) {
    const k = t.clusterKey ?? normalizeKey(t.title);
    byCluster.set(k, [...(byCluster.get(k) ?? []), t]);
  }

  const cands: Candidate[] = [];
  for (const [key, group] of byCluster) {
    group.sort((a, b) => (b.trafficNum ?? 0) - (a.trafficNum ?? 0));
    const lead = group[0];
    const evidence: Evidence[] = [];
    for (const t of group) {
      evidence.push({
        kind: t.source, label: `${SOURCE_LABEL[t.source] ?? t.source}: "${t.title}"${t.approxTraffic ? ` (${t.approxTraffic}${t.source === "google_trends_rss" ? " searches" : ""})` : ""}`,
        url: t.url ?? undefined, metric: t.approxTraffic ?? undefined, observedAt: t.lastSeenAt.toISOString(),
      });
      for (const n of (t.news ?? []).slice(0, 2)) evidence.push({ kind: "news", label: `${n.source ?? "News"}: ${n.title}`, url: n.url, observedAt: t.lastSeenAt.toISOString() });
    }
    const firstSeen = new Date(Math.min(...group.map((t) => t.firstSeenAt.getTime())));
    const lastSeen = new Date(Math.max(...group.map((t) => t.lastSeenAt.getTime())));
    const kinds = new Set(group.map((t) => (t.source.startsWith("manual") ? "manual" : t.source)));
    cands.push({
      topic: lead.title, topicKey: key, kind: "trend", evidence,
      matched: [...new Set(group.flatMap((t) => t.matchedTopics))],
      relevance: Math.max(...group.map((t) => t.relevance)),
      freshness: freshness(firstSeen, lastSeen, now),
      signals: {
        kinds: kinds.size, items: group.length, maxTraffic: Math.max(0, ...group.map((t) => t.trafficNum ?? 0)) || null,
        maxOutlierRatio: null, bestConfidence: "none", manualOnly: group.every((t) => t.supportLevel === "manual"),
      },
      saturation: 0, creators: [], formats: [], preScore: 0,
    });
  }

  // Attach outliers to overlapping trend candidates, else create creator candidates.
  for (const o of outliers) {
    const ot = tokens(o.title);
    const match = cands.find((c) => c.kind === "trend" && (jaccard(ot, tokens(c.topic)) >= 0.3 || ` ${normalizeKey(o.title)} `.includes(` ${c.topicKey} `)));
    const ev: Evidence = {
      kind: "creator_outlier",
      label: `${o.creator}: "${o.title}" at ${o.perfRatio}x their usual (${o.perfBasis ?? "age-adjusted"}; ${o.perfConfidence} confidence)`,
      url: o.url, metric: o.views != null ? `${o.views.toLocaleString()} views` : undefined, observedAt: now.toISOString(),
    };
    if (match) {
      match.evidence.push(ev);
      match.creators.push(o.creator);
      match.formats.push(...o.formats);
      match.signals.kinds += match.signals.maxOutlierRatio == null ? 1 : 0;
      match.signals.items++;
      match.signals.maxOutlierRatio = Math.max(match.signals.maxOutlierRatio ?? 0, o.perfRatio ?? 0);
      match.signals.bestConfidence = RANK_CONF[Math.max(confRank(match.signals.bestConfidence), confRank(o.perfConfidence))];
      match.relevance = Math.min(1, match.relevance + 0.1);
      continue;
    }
    const hook = titleHook(o.title);
    const ageH = (now.getTime() - o.publishedAt.getTime()) / 3_600_000;
    cands.push({
      topic: hook, topicKey: normalizeKey(`${o.creator} ${hook}`), kind: "creator_outlier", evidence: [ev], matched: [o.creator.toLowerCase()],
      relevance: 0.6, // a watched creator's audience overlaps yours by definition
      freshness: Math.max(0.1, Math.pow(0.5, ageH / 72)),
      signals: { kinds: 1, items: 1, maxTraffic: null, maxOutlierRatio: o.perfRatio, bestConfidence: (o.perfConfidence as EvidenceSignals["bestConfidence"]) ?? "low", manualOnly: false },
      saturation: 0, creators: [o.creator], formats: [...o.formats], preScore: 0,
    });
  }

  // Saturation: how many distinct watched creators posted on this topic recently.
  for (const c of cands) {
    const ct = tokens(c.topic);
    const who = new Set(recentCreatorTitles.filter((r) => jaccard(ct, tokens(r.title)) >= 0.35 || ` ${normalizeKey(r.title)} `.includes(` ${c.topicKey} `)).map((r) => r.creator));
    c.saturation = who.size;
    c.formats = [...new Set(c.formats)];
    c.creators = [...new Set(c.creators)];
    c.preScore = c.relevance * 4 + c.freshness * 2 + evidenceStrength(c.signals) / 10 * 3 - Math.max(0, c.saturation - 2) * 0.3;
  }
  return cands.sort((a, b) => b.preScore - a.preScore);
}

/** Cross-creator format patterns become their own candidates ("Rankings are working for X and Y"). */
export function formatCandidates(patterns: { creator: string; format: string; lift: number; outliers: number; total: number; examples: { title: string; url: string }[] }[]): Candidate[] {
  const byFormat = new Map<string, typeof patterns>();
  for (const p of patterns) byFormat.set(p.format, [...(byFormat.get(p.format) ?? []), p]);
  const out: Candidate[] = [];
  for (const [format, ps] of byFormat) {
    if (["caps_hook", "question_title"].includes(format)) continue; // title styling, not a content format
    const evidence: Evidence[] = ps.flatMap((p) => [
      { kind: "format_pattern", label: `${p.creator}: ${formatLabel(format)} shows up in ${p.outliers} of their recent outperformers (${p.lift}x its usual share)` },
      ...p.examples.slice(0, 2).map((e) => ({ kind: "example", label: `${p.creator}: "${e.title}"`, url: e.url })),
    ]);
    const signals: EvidenceSignals = { kinds: Math.min(ps.length, 3), items: ps.length, maxTraffic: null, maxOutlierRatio: Math.max(...ps.map((p) => p.lift)), bestConfidence: "medium", manualOnly: false };
    out.push({
      topic: `${formatLabel(format)} format`, topicKey: `format:${format}`, kind: "format_pattern", evidence, matched: ps.map((p) => p.creator.toLowerCase()),
      relevance: 0.55, freshness: 0.4, signals, saturation: 0, creators: ps.map((p) => p.creator), formats: [format],
      preScore: 0.55 * 4 + 0.4 * 2 + evidenceStrength(signals) / 10 * 3,
    });
  }
  return out;
}
