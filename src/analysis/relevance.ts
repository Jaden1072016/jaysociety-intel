import type { AudienceProfile } from "@/lib/settings";
import { normalizeKey } from "./normalize";

export type RelevanceResult = { score: number; matched: string[]; topics: string[]; excluded: boolean };

function hasPhrase(hay: string, phrase: string): boolean {
  const p = normalizeKey(phrase);
  if (!p) return false;
  return ` ${hay} `.includes(` ${p} `);
}

/**
 * Keyword relevance of text to the Ideal Viewer Profile, 0..1.
 * Transparent on purpose: you can see exactly which keywords matched.
 * Topic hits count more than raw keyword hits so one topic can't dominate by repetition.
 */
export function scoreRelevance(text: string, profile: AudienceProfile, watchedCreators: string[] = []): RelevanceResult {
  const hay = normalizeKey(text);
  const excluded = profile.exclude.some((x) => hasPhrase(hay, x));
  const matched = new Set<string>();
  const topics = new Set<string>();

  for (const [topic, words] of Object.entries(profile.topics)) {
    for (const w of words) if (hasPhrase(hay, w)) { matched.add(w); topics.add(topic); }
  }
  for (const a of profile.musicArtists) if (hasPhrase(hay, a)) { matched.add(a); topics.add("music"); topics.add("favorite_artist"); }
  for (const c of watchedCreators) if (hasPhrase(hay, c)) { matched.add(c); topics.add("streaming"); topics.add("watched_creator"); }

  let score = 0;
  score += Math.min(topics.size, 3) * 0.2; // up to 0.6 for breadth
  score += Math.min(matched.size, 4) * 0.075; // up to 0.3 for depth
  if (topics.has("favorite_artist") || topics.has("watched_creator")) score += 0.15;
  score = Math.min(1, score);
  if (excluded) score *= 0.3; // news you shouldn't make content about (tragedy, politics results)

  return { score: Math.round(score * 100) / 100, matched: [...matched], topics: [...topics], excluded };
}
