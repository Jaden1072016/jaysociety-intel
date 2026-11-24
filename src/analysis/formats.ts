/**
 * Repeatable content formats, detected only from text we actually have (titles, descriptions).
 * Each rule is a plain pattern so it's auditable. No guessing from thumbnails or video content.
 */
export const FORMAT_RULES: { id: string; label: string; re: RegExp }[] = [
  { id: "reaction", label: "Reaction", re: /\breact(s|ing|ion)?\b/i },
  { id: "challenge", label: "Challenge", re: /\bchallenge\b|\bif i lose\b|\blast to\b/i },
  { id: "24_hours", label: "24-hour / time-boxed", re: /\b(24|48|72)\s*(hours?|hrs?)\b|\bfor a (day|week)\b/i },
  { id: "versus", label: "Versus / 1v1", re: /\b(vs\.?|versus|1v1|2v2)\b/i },
  { id: "ranking", label: "Ranking / tier list", re: /\b(tier list|rank(ing|ed)?|top \d+|best (to|and) worst)\b/i },
  { id: "collab", label: "Collab / guest", re: /\b(ft\.?|feat\.?|w\/|with)\s+[A-Z@]/ },
  { id: "irl", label: "IRL / out in public", re: /\b(irl|in public|at the mall|road trip|vlog|trip to)\b/i },
  { id: "music", label: "Music (freestyle, studio, listening)", re: /\b(freestyle|cypher|studio|listening party|album review|first listen|diss)\b/i },
  { id: "dating", label: "Dating / relationship", re: /\b(dating|date|girlfriend|boyfriend|speed ?dating|rizz)\b/i },
  { id: "gaming_story", label: "Gaming story / RP", re: /\b(gta|rp|roleplay|story ?mode|fortnite|2k\d*|nba ?2k\d*|minecraft|warzone)\b/i },
  { id: "storytime", label: "Storytime / Q&A", re: /\b(storytime|story time|q&a|qna|ask me|answering)\b/i },
  { id: "prank", label: "Prank / trolling", re: /\b(prank(ed|ing)?|troll(ed|ing)?|exposed)\b/i },
  { id: "highlight", label: "Stream highlights", re: /\b(highlights?|best moments|funniest moments|clips?)\b/i },
  { id: "subathon", label: "Subathon / marathon", re: /\b(subathon|marathon|day \d+)\b/i },
  { id: "question_title", label: "Question title", re: /\?\s*$/ },
  { id: "caps_hook", label: "ALL-CAPS hook word", re: /\b[A-Z]{4,}\b/ },
];

export function extractFormats(title: string, description = ""): string[] {
  const text = `${title}\n${description.slice(0, 300)}`;
  return FORMAT_RULES.filter((r) => (r.id === "question_title" || r.id === "caps_hook" ? r.re.test(title) : r.re.test(text))).map((r) => r.id);
}

export function formatLabel(id: string): string {
  return FORMAT_RULES.find((r) => r.id === id)?.label ?? id;
}

/**
 * Which formats appear more often among a creator's outperformers than in their catalog overall.
 * lift = share among outperformers / share overall. Requires at least `minCount` outperformers using it.
 */
export function formatLift(
  vids: { formats: string[]; perfRatio: number | null }[],
  outlierRatio = 1.5,
  minCount = 2,
): { format: string; lift: number; outliers: number; total: number }[] {
  const withRatio = vids.filter((v) => v.perfRatio != null);
  const outs = withRatio.filter((v) => (v.perfRatio as number) >= outlierRatio);
  if (!withRatio.length || !outs.length) return [];
  const count = (arr: typeof vids, f: string) => arr.filter((v) => v.formats.includes(f)).length;
  const all = new Set(withRatio.flatMap((v) => v.formats));
  return [...all]
    .map((f) => {
      const o = count(outs, f), t = count(withRatio, f);
      return { format: f, outliers: o, total: t, lift: Math.round(((o / outs.length) / (t / withRatio.length)) * 100) / 100 };
    })
    .filter((x) => x.outliers >= minCount && x.lift > 1)
    .sort((a, b) => b.lift - a.lift);
}

/** The first clause of a title, which is usually the hook. */
export function titleHook(title: string): string {
  const cut = title.split(/\s[|\-–—]\s|\s\(|\s\[|!+\s|\?\s/)[0];
  return cut.length < title.length ? cut.trim() : title.trim();
}
