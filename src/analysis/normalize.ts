const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "at", "by", "with", "is", "vs", "v", "x",
  "my", "i", "me", "we", "you", "it", "this", "that", "new", "official", "video", "ft", "feat", "live",
]);

/** Lowercase, strip accents/punctuation/emojis, collapse whitespace. Used as the dedupe key. */
export function normalizeKey(s: string): string {
  return s
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s: string): string[] {
  return normalizeKey(s).split(" ").filter((t) => t.length > 1 && !STOP.has(t));
}

export function jaccard(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** "2000+" -> 2000, "1M+" -> 1000000, "50K+" -> 50000. null when unparseable. */
export function parseTraffic(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /([\d,.]+)\s*([kKmM])?\+?/.exec(s);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const mult = m[2]?.toLowerCase() === "m" ? 1_000_000 : m[2]?.toLowerCase() === "k" ? 1_000 : 1;
  return Math.round(n * mult);
}

/**
 * Group overlapping topics. Two items join a cluster when their token sets overlap enough,
 * or one title contains the other ("gta 6" and "gta 6 trailer 3").
 * Returns a map of item index -> cluster key (the key of the cluster's first member).
 */
export function clusterTitles(titles: string[], threshold = 0.5): string[] {
  const keys = titles.map(normalizeKey);
  const toks = titles.map(tokens);
  const cluster: string[] = new Array(titles.length);
  for (let i = 0; i < titles.length; i++) {
    if (cluster[i]) continue;
    cluster[i] = keys[i];
    for (let j = i + 1; j < titles.length; j++) {
      if (cluster[j]) continue;
      const contains = keys[i].length >= 3 && keys[j].length >= 3 &&
        (` ${keys[j]} `.includes(` ${keys[i]} `) || ` ${keys[i]} `.includes(` ${keys[j]} `));
      if (contains || jaccard(toks[i], toks[j]) >= threshold) cluster[j] = keys[i];
    }
  }
  return cluster;
}

/** Remove near-duplicates, keeping the first occurrence (callers sort by priority first). */
export function dedupeBy<T>(items: T[], text: (t: T) => string, threshold = 0.6): T[] {
  const out: T[] = [];
  const seen: string[][] = [];
  for (const it of items) {
    const t = tokens(text(it));
    if (seen.some((s) => jaccard(s, t) >= threshold)) continue;
    seen.push(t);
    out.push(it);
  }
  return out;
}
