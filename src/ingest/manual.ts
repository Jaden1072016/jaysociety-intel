import { db, schema } from "@/db";
import * as yt from "@/providers/youtube";
import { storeVideos } from "./creators";
import { upsertTrends } from "./trends";
import { extractFormats } from "@/analysis/formats";
import { ProviderNotConfigured, type FetchLike } from "@/lib/ops";

export const MANUAL_SOURCES = {
  manual_tiktok_cc: "TikTok Creative Center",
  manual_tiktok_search: "TikTok Creator Search Insights",
  manual_yt_trends: "YouTube Studio Trends / Inspiration",
  manual_instagram: "Instagram",
  manual_x: "X",
  manual_other: "Other",
} as const;
export type ManualSource = keyof typeof MANUAL_SOURCES;

export type ParsedLine = { kind: "url" | "term"; text: string; url?: string; views?: number; title?: string };

/**
 * One item per line. Accepted shapes:
 *   term
 *   term, 12000            (CSV with a metric, e.g. search popularity or views)
 *   https://...            (link)
 *   https://... | 45000 | title   (link with views you read off the app, and a title)
 */
export function parseImport(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    let parts: string[];
    if (/[|\t]/.test(line)) parts = line.split(/\s*[|\t]\s*/);
    else {
      // "term, 12,000": split at the first comma whose remainder is a single number
      const m = /^(.*?),\s*([\d.,]+\s*[kKmM]?)\s*$/.exec(line);
      parts = m ? [m[1], m[2]] : [line];
    }
    parts = parts.map((s) => s.trim()).filter(Boolean);
    const first = parts[0];
    const views = parts.slice(1).map(parseCount).find((n) => n != null) ?? undefined;
    const title = parts.slice(1).find((p) => parseCount(p) == null);
    if (/^https?:\/\//i.test(first)) out.push({ kind: "url", text: first, url: first, views, title });
    else out.push({ kind: "term", text: first, views });
  }
  return out;
}

export function parseCount(s: string): number | null {
  const m = /^([\d.,]+)\s*([kKmM])?$/.exec(s.trim());
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const mult = m[2]?.toLowerCase() === "m" ? 1e6 : m[2]?.toLowerCase() === "k" ? 1e3 : 1;
  return Math.round(n * mult);
}

export function platformOf(url: string): string {
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/tiktok\.com/i.test(url)) return "tiktok";
  if (/instagram\.com/i.test(url)) return "instagram";
  if (/twitch\.tv/i.test(url)) return "twitch";
  if (/^https?:\/\/([\w-]+\.)?(x|twitter)\.com\//i.test(url)) return "x";
  return "web";
}

/**
 * Import research. YouTube links are fetched from the official API (real metrics).
 * Other links and terms are stored as manually supplied, labeled as such; any numbers come from you.
 */
export async function importManual(source: ManualSource, text: string, opts: { fetchImpl?: FetchLike } = {}) {
  const lines = parseImport(text);
  const ytIds = lines.filter((l) => l.kind === "url" && platformOf(l.url!) === "youtube")
    .map((l) => yt.videoIdFromUrl(l.url!)).filter((x): x is string => Boolean(x));
  let videos = 0;
  let ytOk = false;
  const notes: string[] = [];
  if (ytIds.length) {
    try {
      const vids = await yt.getVideos(ytIds, opts);
      videos += (await storeVideos("youtube", null, vids, { source: "manual" })).length;
      ytOk = true;
    } catch (e) {
      notes.push(e instanceof ProviderNotConfigured ? "YouTube links saved as links only (no API key)." : `YouTube lookup failed: ${(e as Error).message}`);
    }
  }
  const trendItems = lines
    .filter((l) => !(ytOk && l.kind === "url" && platformOf(l.url!) === "youtube"))
    .map((l) => ({
      source, title: l.title ?? (l.kind === "term" ? l.text : l.url!), url: l.url ?? null,
      approxTraffic: l.views != null ? `${l.views.toLocaleString()} (you entered)` : null, trafficNum: l.views ?? null,
      supportLevel: "manual",
    }));
  const t = trendItems.length ? await upsertTrends(trendItems) : { inserted: 0, updated: 0 };

  // Non-YouTube video links with a view count become manual videos for historical analysis.
  for (const l of lines) {
    if (l.kind !== "url" || platformOf(l.url!) === "youtube" || l.views == null) continue;
    const p = platformOf(l.url!);
    await db.insert(schema.videos).values({
      platform: p, externalId: l.url!, url: l.url!, title: l.title ?? l.url!, publishedAt: new Date(),
      format: p === "tiktok" || p === "instagram" ? "short" : "unknown", source: "manual",
      latestViews: l.views, formats: extractFormats(l.title ?? ""),
    }).onConflictDoUpdate({ target: [schema.videos.platform, schema.videos.externalId], set: { latestViews: l.views } });
    videos++;
  }
  return { lines: lines.length, trends: t.inserted + t.updated, videos, notes };
}
