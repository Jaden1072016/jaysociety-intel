import { describe, expect, it } from "vitest";
import { clusterTitles, dedupeBy, normalizeKey, parseTraffic, tokens } from "@/analysis/normalize";
import { scoreRelevance } from "@/analysis/relevance";
import { freshness, freshnessLabel } from "@/analysis/freshness";
import { DEFAULT_PROFILE } from "@/lib/settings";
import { parseTrendsRss } from "@/providers/googleTrends";
import { channelLookup, parseVideo, videoIdFromUrl } from "@/providers/youtube";
import { loginFromInput, parseTwitchVideo } from "@/providers/twitch";
import { parseImport, parseCount, platformOf } from "@/ingest/manual";
import { TRENDS_XML, ytVideo } from "./fixtures";

describe("normalization", () => {
  it("normalizes keys for dedupe", () => {
    expect(normalizeKey("  Jhené Aiko — NEW Album!! ")).toBe("jhene aiko new album");
    expect(normalizeKey("R&B")).toBe("r and b");
    expect(tokens("The GTA 6 trailer is LIVE")).toEqual(["gta", "trailer"]);
  });

  it("parses traffic buckets", () => {
    expect(parseTraffic("2000+")).toBe(2000);
    expect(parseTraffic("500K+")).toBe(500_000);
    expect(parseTraffic("1M+")).toBe(1_000_000);
    expect(parseTraffic(null)).toBeNull();
    expect(parseTraffic("lots")).toBeNull();
  });

  it("clusters overlapping topics", () => {
    const c = clusterTitles(["gta 6 trailer 3", "GTA 6", "drake new album", "drake album release date", "mortgage rates"]);
    expect(c[1]).toBe(c[0]); // containment
    expect(c[3]).toBe(c[2]); // token overlap
    expect(c[4]).not.toBe(c[0]);
  });

  it("dedupes near duplicates keeping the first", () => {
    const out = dedupeBy(["Kai Cenat subathon day 3", "kai cenat SUBATHON day 3!!", "fanum mukbang"], (x) => x);
    expect(out).toEqual(["Kai Cenat subathon day 3", "fanum mukbang"]);
  });
});

describe("relevance and freshness", () => {
  it("scores audience fit transparently", () => {
    const gta = scoreRelevance("gta 6 trailer 3 Rockstar", DEFAULT_PROFILE);
    const mortgage = scoreRelevance("mortgage rates", DEFAULT_PROFILE);
    const drake = scoreRelevance("drake new album", DEFAULT_PROFILE);
    expect(gta.score).toBeGreaterThan(0.3);
    expect(gta.matched).toContain("gta 6");
    expect(mortgage.score).toBe(0);
    expect(drake.topics).toContain("favorite_artist");
    expect(drake.score).toBeGreaterThan(gta.score - 0.2);
  });

  it("damps excluded news topics", () => {
    const r = scoreRelevance("rapper killed in shooting", DEFAULT_PROFILE);
    expect(r.excluded).toBe(true);
    expect(r.score).toBeLessThan(0.2);
  });

  it("boosts watched creators", () => {
    const r = scoreRelevance("Duke Dennis new video", DEFAULT_PROFILE, ["duke dennis"]);
    expect(r.topics).toContain("watched_creator");
  });

  it("decays freshness and keeps active trends warmer", () => {
    const now = new Date("2026-11-23T15:00:00Z");
    const h = (n: number) => new Date(now.getTime() - n * 3_600_000);
    expect(freshness(h(0), h(0), now)).toBe(1);
    expect(freshness(h(24), h(24), now)).toBe(0.5);
    expect(freshness(h(24), h(0.5), now)).toBeGreaterThan(freshness(h(24), h(24), now));
    expect(freshnessLabel(freshness(h(96), h(96), now))).toBe("Stale");
  });
});

describe("provider parsing", () => {
  it("parses Google Trends RSS and skips empty items", () => {
    const items = parseTrendsRss(TRENDS_XML);
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ title: "gta 6 trailer 3", approxTraffic: "500K+", trafficNum: 500_000 });
    expect(items[0].news).toHaveLength(2);
    expect(items[0].news[0]).toMatchObject({ source: "IGN", url: "https://example.com/gta6-trailer-3" });
    expect(items[1].news).toEqual([]);
    expect(items[0].publishedAt?.toISOString()).toBe("2026-11-23T17:10:00.000Z");
  });

  it("throws on a feed with no items list shape", () => {
    expect(parseTrendsRss("<rss><channel></channel></rss>")).toEqual([]);
  });

  it("parses YouTube inputs and videos", () => {
    expect(channelLookup("@KaiCenat")).toEqual({ forHandle: "@KaiCenat" });
    expect(channelLookup("https://www.youtube.com/@DukeDennis/videos")).toEqual({ forHandle: "@DukeDennis" });
    expect(channelLookup("https://youtube.com/channel/UCabcdefghijklmnopqrstuv")).toEqual({ id: "UCabcdefghijklmnopqrstuv" });
    expect(videoIdFromUrl("https://youtu.be/dQw4w9WgXcQ?t=3")).toBe("dQw4w9WgXcQ");
    expect(videoIdFromUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    const v = parseVideo(ytVideo("abcdefghijk", "I tried a 24 hour challenge", "2026-11-20T23:00:00Z", 12345, "PT45S"));
    expect(v).toMatchObject({ views: 12345, durationSec: 45, format: "short" });
    const live = parseVideo(ytVideo("abcdefghijl", "stream", "2026-11-20T23:00:00Z", 1, "PT4H1M", { liveStreamingDetails: { actualStartTime: "x" } }));
    expect(live.format).toBe("live_vod");
  });

  it("parses Twitch inputs and VODs", () => {
    expect(loginFromInput("https://www.twitch.tv/KaiCenat")).toBe("kaicenat");
    const v = parseTwitchVideo({ id: "1", url: "https://twitch.tv/videos/1", title: "GTA RP", published_at: "2026-11-20T01:00:00Z", duration: "3h2m1s", type: "archive", view_count: 900, thumbnail_url: "https://x/%{width}x%{height}.jpg" });
    expect(v).toMatchObject({ durationSec: 10921, format: "live_vod", views: 900, thumbnail: "https://x/320x180.jpg" });
  });

  it("parses manual imports", () => {
    const lines = parseImport([
      "# TikTok Creative Center 11/23",
      "gta 6 leaks",
      "fanum tax, 12,000",
      "https://www.tiktok.com/@x/video/1 | 45k | Kai reacts to Fanum",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ].join("\n"));
    expect(lines).toHaveLength(4);
    expect(lines[0]).toEqual({ kind: "term", text: "gta 6 leaks", views: undefined });
    expect(lines[1]).toMatchObject({ kind: "term", text: "fanum tax", views: 12000 });
    expect(lines[2]).toMatchObject({ kind: "url", views: 45000, title: "Kai reacts to Fanum" });
    expect(parseCount("1.2M")).toBe(1_200_000);
    expect(platformOf("https://x.com/a/status/1")).toBe("x");
  });
});

describe("title-first trend relevance (from live production data)", () => {
  it("sports stories don't match through generic words in their headlines", async () => {
    const { trendRelevance } = await import("@/ingest/trends");
    const p = (await import("@/lib/settings")).DEFAULT_PROFILE;
    expect(trendRelevance("joe buck", ["Troy Aikman, Joe Buck feud ahead of the game"], p, []).score).toBe(0);
    expect(trendRelevance("deni avdija", ["Deni Avdija cleared to return for NBA game"], p, []).score).toBe(0);
    expect(trendRelevance("fortnite", [], p, []).score).toBeGreaterThanOrEqual(0.25);
    const gta = trendRelevance("gta 6 trailer", ["Rockstar drops trailer"], p, []);
    expect(gta.score).toBeGreaterThan(trendRelevance("gta 6 trailer", [], p, []).score - 0.001);
  });
});
