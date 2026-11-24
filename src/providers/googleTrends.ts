import { XMLParser } from "fast-xml-parser";
import { fetchWithRetry, type FetchLike } from "@/lib/ops";
import { parseTraffic } from "@/analysis/normalize";
import type { NewsItem } from "@/db/schema";

export const TRENDS_RSS = (geo = "US") => `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`;

export type RawTrend = {
  title: string;
  approxTraffic: string | null;
  trafficNum: number | null;
  publishedAt: Date | null;
  news: NewsItem[];
  url: string;
};

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: false, isArray: (n) => n === "item" || n === "ht:news_item" });

/** Parses the public "Trending now" RSS. Missing/renamed fields degrade to null, never throw per item. */
export function parseTrendsRss(xml: string): RawTrend[] {
  const doc = parser.parse(xml);
  const items: unknown[] = doc?.rss?.channel?.item ?? [];
  if (!Array.isArray(items)) throw new Error("Trends RSS: no <item> list found (format may have changed)");
  const out: RawTrend[] = [];
  for (const raw of items) {
    const it = raw as Record<string, unknown>;
    const title = String(it.title ?? "").trim();
    if (!title) continue;
    const traffic = it["ht:approx_traffic"] != null ? String(it["ht:approx_traffic"]) : null;
    const pub = it.pubDate ? new Date(String(it.pubDate)) : null;
    const newsRaw = (it["ht:news_item"] as Record<string, unknown>[] | undefined) ?? [];
    const news: NewsItem[] = newsRaw
      .map((n) => ({
        title: String(n["ht:news_item_title"] ?? "").trim(),
        url: String(n["ht:news_item_url"] ?? "").trim(),
        source: n["ht:news_item_source"] ? String(n["ht:news_item_source"]) : undefined,
      }))
      .filter((n) => n.title && /^https?:\/\//.test(n.url));
    out.push({
      title,
      approxTraffic: traffic,
      trafficNum: parseTraffic(traffic),
      publishedAt: pub && !Number.isNaN(pub.getTime()) ? pub : null,
      news,
      url: `https://trends.google.com/trends/explore?geo=US&q=${encodeURIComponent(title)}&date=now%201-d`,
    });
  }
  return out;
}

export async function fetchTrends(geo = "US", fetchImpl?: FetchLike): Promise<RawTrend[]> {
  const res = await fetchWithRetry(TRENDS_RSS(geo), { headers: { "User-Agent": "JaySocietyCreatorIntel/1.0" } }, { fetchImpl });
  return parseTrendsRss(await res.text());
}
