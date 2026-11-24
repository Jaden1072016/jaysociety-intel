import { describe, expect, it } from "vitest";
import { computePerformance, classifyFormat, parseIsoDuration, perfLabel, type PeerObs } from "@/analysis/performance";
import { extractFormats, formatLift, titleHook } from "@/analysis/formats";
import { postingAdvice, windowStats, CAVEAT } from "@/analysis/posting";
import { evidenceStrength, finalizeScores, originalityCap, totalScore, SCORE_DISCLAIMER, WEIGHTS } from "@/engine/scoring";
import { buildCandidates, type TrendRow, type OutlierRow } from "@/engine/candidates";
import { rulesIdea } from "@/engine/rules";
import { parseIdeas, costOf, buildPrompt } from "@/engine/claude";
import { DEFAULT_PROFILE } from "@/lib/settings";

describe("creator performance baselines", () => {
  const peers = (format: string, ageHours: number, views: number[]): PeerObs[] =>
    views.map((v, i) => ({ videoId: `${format}-${ageHours}-${i}`, format, ageHours, views: v }));

  it("compares against same-format videos at a similar age", () => {
    const obs = [...peers("long", 24, [100, 120, 80, 110, 90]), ...peers("short", 24, [5000, 6000, 7000, 8000, 9000])];
    const r = computePerformance({ id: "x", format: "long", ageHours: 30, views: 300 }, obs);
    expect(r.baseline).toBe(100);
    expect(r.ratio).toBe(3);
    expect(r.confidence).toBe("medium");
    expect(r.basis).toMatch(/similar age/);
  });

  it("does not compare a young video to week-old totals at face value", () => {
    const obs = peers("long", 168, [1000, 1100, 900, 1050, 950]);
    const r = computePerformance({ id: "x", format: "long", ageHours: 12, views: 600 }, obs);
    expect(r.confidence).toBe("low"); // falls back to age-adjusted estimate, labeled low
    expect(r.ratio!).toBeGreaterThan(0.5); // 600 views at 12h is not "0.6x" of a week-old total
    expect(r.basis).toMatch(/not enough same-age history/);
  });

  it("refuses to judge videos under 6 hours old", () => {
    const obs = peers("long", 3, [100, 100, 100, 100, 100, 100]);
    const r = computePerformance({ id: "x", format: "long", ageHours: 3, views: 5000 }, obs);
    expect(r).toMatchObject({ ratio: null, confidence: "none" });
    expect(r.basis).toMatch(/Too new/);
  });

  it("never shows a low-confidence estimate as a confident claim", () => {
    expect(perfLabel(4, "low")).toMatch(/low confidence/);
    expect(perfLabel(4, "medium")).not.toMatch(/low confidence/);
  });

  it("reports no ratio without enough history", () => {
    expect(computePerformance({ id: "x", format: "long", ageHours: 5, views: 10 }, []).confidence).toBe("none");
    expect(perfLabel(null, "none")).toBe("Not enough history");
  });

  it("classifies formats and durations", () => {
    expect(parseIsoDuration("PT1H2M3S")).toBe(3723);
    expect(classifyFormat("youtube", 170)).toBe("short");
    expect(classifyFormat("youtube", 900)).toBe("long");
    expect(classifyFormat("twitch", 100, { twitchType: "highlight" })).toBe("highlight");
  });
});

describe("format extraction", () => {
  it("extracts repeatable formats from titles only", () => {
    expect(extractFormats("Duke Dennis REACTS to 2K26 ratings")).toEqual(expect.arrayContaining(["reaction", "gaming_story", "caps_hook"]));
    expect(extractFormats("Ranking every Drake album")).toContain("ranking");
    expect(extractFormats("normal title")).toEqual([]);
    expect(titleHook("I Spent 24 Hours With Fanum | AMP")).toBe("I Spent 24 Hours With Fanum");
  });

  it("computes format lift among outperformers", () => {
    const vids = [
      { formats: ["ranking"], perfRatio: 3 }, { formats: ["ranking"], perfRatio: 2 }, { formats: ["reaction"], perfRatio: 0.8 },
      { formats: ["reaction"], perfRatio: 1 }, { formats: ["reaction"], perfRatio: 0.9 }, { formats: [], perfRatio: 1 },
    ];
    const lift = formatLift(vids);
    expect(lift[0].format).toBe("ranking");
    expect(lift[0].lift).toBeGreaterThan(1);
    expect(lift.find((l) => l.format === "reaction")).toBeUndefined();
  });
});

describe("posting strategy", () => {
  it("never claims causation and prefers own data", () => {
    const own = Array.from({ length: 14 }, (_, i) => ({
      publishedAt: new Date(Date.UTC(2026, 10, 1 + i, i % 2 ? 23 : 15)), // 6 PM ET vs 10 AM ET
      perfRatio: i % 2 ? 2 : 0.8,
    }));
    const a = postingAdvice(own, []);
    expect(a.basis).toBe("own");
    expect(a.headline).toMatch(/6–9 PM/);
    expect(a.caveat).toBe(CAVEAT);
    expect(a.caveat).toMatch(/association only/);
  });

  it("falls back to benchmarks and labels them as when-they-post, not what-works", () => {
    const bench = Array.from({ length: 25 }, (_, i) => ({ publishedAt: new Date(Date.UTC(2026, 10, 1 + (i % 7), 22)) }));
    const a = postingAdvice([], bench);
    expect(a.basis).toBe("benchmark");
    expect(a.detail.join(" ")).toMatch(/not proof/);
  });

  it("buckets by Eastern time", () => {
    const s = windowStats([{ publishedAt: new Date("2026-11-23T23:30:00Z"), perfRatio: 1 }]); // 6:30 PM ET
    expect(s.find((x) => x.block === "6–9 PM")!.posts).toBe(1);
  });
});

describe("opportunity scoring", () => {
  it("is a weighted 0-100 internal estimate", () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    const max = { audienceRelevance: 10, freshness: 10, evidenceStrength: 10, feasibility: 10, originality: 10, collaboration: 10 };
    expect(totalScore(max)).toBe(100);
    expect(totalScore({ ...max, audienceRelevance: 0 })).toBe(75);
    expect(totalScore({ ...max, feasibility: 99 })).toBe(100); // clamped
    expect(SCORE_DISCLAIMER).toMatch(/Not a prediction/);
  });

  it("rewards independent sources and penalizes manual-only evidence", () => {
    const base = { kinds: 1, items: 1, maxTraffic: null, maxOutlierRatio: null, bestConfidence: "none" as const, manualOnly: false };
    expect(evidenceStrength({ ...base, kinds: 3 })).toBeGreaterThan(evidenceStrength(base));
    expect(evidenceStrength({ ...base, manualOnly: true })).toBeLessThan(evidenceStrength(base));
    expect(evidenceStrength({ ...base, maxTraffic: 50 })).toBe(evidenceStrength(base)); // tiny traffic never subtracts
  });

  it("caps originality when the topic is crowded", () => {
    expect(originalityCap(5)).toBe(4);
    const s = finalizeScores({ audienceRelevance: 8, freshness: 8, evidenceStrength: 8 }, { feasibility: 8, originality: 9, collaboration: 5 }, 4);
    expect(s.originality).toBe(4);
  });
});

describe("candidates and generators", () => {
  const now = new Date("2026-11-23T15:00:00Z");
  const trend = (title: string, extra: Partial<TrendRow> = {}): TrendRow => ({
    id: title, source: "google_trends_rss", title, url: null, approxTraffic: "100K+", trafficNum: 100_000,
    firstSeenAt: new Date(now.getTime() - 3_600_000), lastSeenAt: now, relevance: 0.6, matchedTopics: ["gta 6"],
    clusterKey: null, news: [{ title: "news", url: "https://example.com/n", source: "IGN" }], supportLevel: "full", ...extra,
  });
  const outlier = (title: string, creator: string): OutlierRow => ({
    id: title, title, url: "https://youtube.com/watch?v=x", platform: "youtube", publishedAt: new Date(now.getTime() - 20 * 3_600_000),
    format: "long", formats: ["reaction"], views: 900_000, perfRatio: 3.2, perfConfidence: "medium", perfBasis: "vs 8 of their long videos at a similar age", creator,
  });

  it("merges creator outliers into overlapping trends (cross-source evidence)", () => {
    const c = buildCandidates([trend("gta 6 trailer 3", { clusterKey: "gta 6 trailer 3" })], [outlier("Reacting to GTA 6 Trailer 3", "Duke Dennis"), outlier("Fanum mukbang", "Fanum")], [], now);
    const gta = c.find((x) => x.topicKey === "gta 6 trailer 3")!;
    expect(gta.creators).toEqual(["Duke Dennis"]);
    expect(gta.signals.kinds).toBe(2);
    expect(gta.evidence.some((e) => e.kind === "creator_outlier" && /3.2x their usual/.test(e.label))).toBe(true);
    expect(c.find((x) => x.kind === "creator_outlier")!.topic).toBe("Fanum mukbang");
  });

  it("measures saturation from watched creators' recent titles", () => {
    const recent = ["Kai", "Duke", "Fanum", "Lacy"].map((creator) => ({ creator, title: "GTA 6 trailer 3 reaction" }));
    const [c] = buildCandidates([trend("gta 6 trailer 3")], [], recent, now);
    expect(c.saturation).toBe(4);
  });

  it("rules generator only uses the topic and evidence it was given", () => {
    const [c] = buildCandidates([trend("gta 6 trailer 3")], [], [], now);
    const idea = rulesIdea(c);
    expect(idea.title).toContain("gta 6 trailer 3");
    expect(idea.platforms).toContain("Twitch");
    expect(idea.aiNotes).toMatch(/no AI/);
    expect(JSON.stringify(idea)).not.toMatch(/—/);
  });

  it("validates Claude output and strips em dashes", () => {
    const out = parseIdeas('Here you go: {"ideas":[{"topicKey":"k","title":"Ranking — every trailer","hook":"Hook","concept":"A concept long enough","livestream":"","clips":["a"],"platforms":["TikTok"],"production":"phone","whyFits":"fits","aiNotes":"assumed","feasibility":8,"originality":7,"collaboration":4}]}');
    expect(out[0].title).toBe("Ranking, every trailer");
    expect(() => parseIdeas('{"ideas":[{"topicKey":"k"}]}')).toThrow();
    expect(() => parseIdeas("no json")).toThrow();
  });

  it("prices Haiku 5.5 correctly and keeps the prompt evidence-bound", () => {
    expect(costOf("claude-haiku-5-5", 1_000_000, 1_000_000)).toBeCloseTo(0.6);
    expect(costOf("unknown-model", 1_000_000, 0)).toBe(2); // conservative default
    const { system } = buildPrompt([], DEFAULT_PROFILE);
    expect(system).toMatch(/ONLY facts present in the evidence/);
  });
});
