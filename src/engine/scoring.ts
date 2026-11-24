import type { Scores } from "@/db/schema";

/**
 * Internal prioritization estimate, 0-100. NOT a probability of going viral.
 * Three inputs are measured from evidence (relevance, freshness, evidence strength).
 * Three are judgments about the idea (feasibility, originality, collaboration), from Claude or rules.
 */
export const WEIGHTS: Record<keyof Scores, number> = {
  audienceRelevance: 0.25,
  freshness: 0.15,
  evidenceStrength: 0.2,
  feasibility: 0.15,
  originality: 0.15,
  collaboration: 0.1,
};

export const SCORE_LABELS: Record<keyof Scores, string> = {
  audienceRelevance: "Audience fit",
  freshness: "Freshness",
  evidenceStrength: "Evidence",
  feasibility: "Doable for you",
  originality: "Originality",
  collaboration: "Collab potential",
};

export const SCORE_DISCLAIMER = "Internal priority estimate for ordering your options. Not a prediction of views or virality.";

const clamp = (n: number) => Math.max(0, Math.min(10, Math.round(n * 10) / 10));

export function totalScore(s: Scores): number {
  let t = 0;
  for (const k of Object.keys(WEIGHTS) as (keyof Scores)[]) t += clamp(s[k]) * WEIGHTS[k];
  return Math.round(t * 10 * 10) / 10; // 0..100, one decimal
}

export type EvidenceSignals = {
  kinds: number; // distinct evidence types (search trend, creator outlier, twitch category, manual import)
  items: number;
  maxTraffic: number | null; // Google Trends bucket
  maxOutlierRatio: number | null;
  bestConfidence: "high" | "medium" | "low" | "none";
  manualOnly: boolean;
};

export function evidenceStrength(e: EvidenceSignals): number {
  let s = 0;
  s += Math.min(e.kinds, 3) * 2; // independent sources agreeing matters most
  s += Math.min(e.items, 5) * 0.4;
  if (e.maxTraffic) s += Math.max(0, Math.min(2, Math.log10(Math.max(e.maxTraffic, 1)) - 2)); // 1000 -> 1, 10k+ -> 2
  if (e.maxOutlierRatio) s += Math.min(2, e.maxOutlierRatio / 2);
  if (e.bestConfidence === "low") s -= 1;
  if (e.manualOnly) s -= 1.5; // you typed it in; we couldn't verify the numbers
  return clamp(s);
}

/** Saturation lowers originality: if many watched creators already covered it, it's crowded. */
export function originalityCap(saturation: number): number {
  if (saturation >= 4) return 4;
  if (saturation >= 2) return 7;
  return 10;
}

export function finalizeScores(measured: Pick<Scores, "audienceRelevance" | "freshness" | "evidenceStrength">,
  judged: Pick<Scores, "feasibility" | "originality" | "collaboration">, saturation: number): Scores {
  return {
    audienceRelevance: clamp(measured.audienceRelevance),
    freshness: clamp(measured.freshness),
    evidenceStrength: clamp(measured.evidenceStrength),
    feasibility: clamp(judged.feasibility),
    originality: clamp(Math.min(judged.originality, originalityCap(saturation))),
    collaboration: clamp(judged.collaboration),
  };
}
