import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { resetDb, fakeFetch } from "./db";
import { TRENDS_XML, ytVideo } from "./fixtures";
import { attemptLogin, checkPassword, MAX_FAILURES } from "@/lib/auth";
import { createSessionToken, verifySessionToken } from "@/lib/session";
import { encrypt, decrypt } from "@/lib/crypto";
import { fetchWithRetry, spendUnits, BudgetExceeded, HttpError } from "@/lib/ops";
import { ingestGoogleTrends } from "@/ingest/trends";
import { refreshAccount, resolveAccount, recentOutliers, refreshAllCreators } from "@/ingest/creators";
import { importManual } from "@/ingest/manual";
import { generateOpportunities } from "@/engine/generate";
import { claudeIdeas } from "@/engine/claude";
import { DEFAULT_AI, DEFAULT_PROFILE, setSetting, DEFAULT_NOTIFICATIONS } from "@/lib/settings";
import { runJob, tick, TASKS } from "@/jobs";
import { dueSlot } from "@/jobs/scheduler";
import { notify, shouldSend } from "@/notify/push";
import { buildBriefing } from "@/engine/briefing";
import bcrypt from "bcryptjs";

beforeEach(resetDb);

describe("authentication", () => {
  it("checks plain and hashed passwords", async () => {
    expect(await checkPassword("correct horse battery staple")).toBe(true);
    expect(await checkPassword("wrong")).toBe(false);
    expect(await checkPassword("")).toBe(false);
    const hash = await bcrypt.hash("pw-123456", 4);
    expect(await checkPassword("pw-123456", { APP_PASSWORD_HASH: hash } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(await checkPassword("nope", { APP_PASSWORD_HASH: hash } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(await checkPassword("x", {} as unknown as NodeJS.ProcessEnv)).toBe(false); // no password configured = locked
  });

  it("locks out an IP after repeated failures", async () => {
    for (let i = 0; i < MAX_FAILURES; i++) expect((await attemptLogin("1.2.3.4", "bad")).ok).toBe(false);
    const locked = await attemptLogin("1.2.3.4", "correct horse battery staple");
    expect(locked).toEqual({ ok: false, error: expect.stringMatching(/Too many attempts/) });
    expect((await attemptLogin("5.6.7.8", "correct horse battery staple")).ok).toBe(true);
  });

  it("issues sessions that can't be forged", async () => {
    const t = await createSessionToken();
    expect(await verifySessionToken(t)).toBe(true);
    expect(await verifySessionToken(t.slice(0, -2) + "xx")).toBe(false);
    expect(await verifySessionToken(undefined)).toBe(false);
  });

  it("encrypts tokens at rest", () => {
    const e = encrypt("ya29.secret");
    expect(e).not.toContain("secret");
    expect(decrypt(e)).toBe("ya29.secret");
    const [v, iv, tag, data] = e.split(".");
    const flipped = (tag[0] === "A" ? "B" : "A") + tag.slice(1);
    expect(() => decrypt([v, iv, flipped, data].join("."))).toThrow();
  });
});

describe("failure handling", () => {
  it("retries 5xx and 429, fails fast on 4xx", async () => {
    let n = 0;
    const flaky = (async () => (++n < 3 ? new Response("down", { status: 503 }) : new Response("ok"))) as typeof fetch;
    expect(await (await fetchWithRetry("https://a.test/x", {}, { fetchImpl: flaky, baseDelayMs: 1 })).text()).toBe("ok");
    expect(n).toBe(3);
    let m = 0;
    const bad = (async () => { m++; return new Response("bad key", { status: 403 }); }) as typeof fetch;
    await expect(fetchWithRetry("https://a.test/x", {}, { fetchImpl: bad, baseDelayMs: 1 })).rejects.toBeInstanceOf(HttpError);
    expect(m).toBe(1);
  });

  it("enforces daily API budgets", async () => {
    await spendUnits("youtube_data", "2026-11-23", 9, 10);
    await expect(spendUnits("youtube_data", "2026-11-23", 2, 10)).rejects.toBeInstanceOf(BudgetExceeded);
    await spendUnits("youtube_data", "2026-11-24", 2, 10); // new day resets
  });

  it("records provider failure but keeps the rest of the job going", async () => {
    const down = (async () => new Response("err", { status: 500 })) as typeof fetch;
    await expect(ingestGoogleTrends({ fetchImpl: down })).rejects.toThrow();
    const [st] = await db.select().from(schema.providerStatus).where(eq(schema.providerStatus.provider, "google_trends_rss"));
    expect(st.consecutiveFailures).toBe(1);
    expect(st.lastError).toMatch(/HTTP 500/);
    // The trends job itself settles each part and still completes.
    const r = await runJob("trends", "slot-1", () => TASKS.trends(new Date()));
    expect(r).toBe("ok");
  });
});

describe("trend ingestion", () => {
  it("ingests, dedupes across refreshes, scores relevance and clusters overlaps", async () => {
    const f = fakeFetch({ "trends.google.com": () => ({ body: TRENDS_XML }) });
    const first = await ingestGoogleTrends({ fetchImpl: f.impl });
    expect(first.inserted).toBe(4);
    const again = await ingestGoogleTrends({ fetchImpl: f.impl });
    expect(again).toEqual({ inserted: 0, updated: 4 });
    const rows = await db.select().from(schema.trends);
    expect(rows).toHaveLength(4);
    const gta = rows.find((r) => r.title === "gta 6 trailer 3")!;
    const gtaShort = rows.find((r) => r.title === "GTA 6")!;
    const mortgage = rows.find((r) => r.title === "mortgage rates")!;
    expect(gta.seenCount).toBe(2);
    expect(gta.relevance).toBeGreaterThan(0.3);
    expect(mortgage.relevance).toBe(0);
    expect(gtaShort.clusterKey).toBe(gta.clusterKey);
    const [st] = await db.select().from(schema.providerStatus).where(eq(schema.providerStatus.provider, "google_trends_rss"));
    expect(st.lastSuccessAt).not.toBeNull();
  });

  it("imports manual research labeled as manual", async () => {
    const r = await importManual("manual_tiktok_cc", "fanum tax\nhttps://www.tiktok.com/@a/video/1 | 45k | Kai reacts to Fanum");
    expect(r.lines).toBe(2);
    const rows = await db.select().from(schema.trends);
    expect(rows.every((x) => x.supportLevel === "manual")).toBe(true);
    const [v] = await db.select().from(schema.videos);
    expect(v).toMatchObject({ platform: "tiktok", source: "manual", latestViews: 45000 });
  });
});

describe("creator intelligence", () => {
  async function seedCreator(handle = "@DukeDennis") {
    const [c] = await db.insert(schema.creators).values({ name: "Duke Dennis", slug: "duke-dennis" }).returning();
    const [a] = await db.insert(schema.creatorAccounts).values({ creatorId: c.id, platform: "youtube", handle }).returning();
    return { c, a };
  }

  it("resolves a handle without auto-verifying it", async () => {
    process.env.YOUTUBE_API_KEY = "test";
    const { a } = await seedCreator();
    const f = fakeFetch({ "/channels": () => ({ body: { items: [{ id: "UCaaaaaaaaaaaaaaaaaaaaaa", snippet: { title: "Duke Dennis", customUrl: "@dukedennis" }, statistics: { subscriberCount: "5000000" }, contentDetails: { relatedPlaylists: { uploads: "UUaaaa" } } }] } }) });
    const ch = await resolveAccount(a.id, { fetchImpl: f.impl });
    expect(ch).toMatchObject({ title: "Duke Dennis", subscribers: 5_000_000 });
    const [after] = await db.select().from(schema.creatorAccounts).where(eq(schema.creatorAccounts.id, a.id));
    expect(after.verified).toBe(false);
    expect(after.externalId).toBe("UCaaaaaaaaaaaaaaaaaaaaaa");
    delete process.env.YOUTUBE_API_KEY;
  });

  it("records a clear error when the API key is missing", async () => {
    const { a } = await seedCreator();
    expect(await resolveAccount(a.id)).toBeNull();
    const [after] = await db.select().from(schema.creatorAccounts).where(eq(schema.creatorAccounts.id, a.id));
    expect(after.resolveError).toMatch(/YOUTUBE_API_KEY/);
  });

  it("stores videos, snapshots and age-adjusted outliers", async () => {
    process.env.YOUTUBE_API_KEY = "test";
    const { a } = await seedCreator();
    await db.update(schema.creatorAccounts).set({ externalId: "UCaaaaaaaaaaaaaaaaaaaaaa", uploadsPlaylist: "UUaaaa", verified: true }).where(eq(schema.creatorAccounts.id, a.id));
    const now = new Date("2026-11-23T15:00:00Z");
    const ids = Array.from({ length: 8 }, (_, i) => `vid${String(i).padStart(8, "0")}`);
    const pub = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
    const items = ids.map((id, i) => ytVideo(id, i === 0 ? "I REACTED to GTA 6 Trailer 3" : `Normal video ${i}`, pub(48 + i * 2), i === 0 ? 3_000_000 : 1_000_000 + i * 10_000));
    const f = fakeFetch({
      "/playlistItems": () => ({ body: { items: ids.map((id) => ({ contentDetails: { videoId: id } })) } }),
      "/videos": () => ({ body: { items } }),
    });
    const r = await refreshAccount(a.id, { fetchImpl: f.impl, now });
    expect(r.stored).toBe(8);
    const snaps = await db.select().from(schema.videoSnapshots);
    expect(snaps).toHaveLength(8);
    const outs = await recentOutliers(10, 1.5, now);
    expect(outs).toHaveLength(1);
    expect(outs[0].title).toMatch(/GTA 6/);
    expect(outs[0].perfRatio!).toBeGreaterThan(2.5);
    expect(outs[0].perfBasis).toMatch(/similar age/);
    delete process.env.YOUTUBE_API_KEY;
  });

  it("only refreshes verified accounts and stops hammering an unconfigured provider", async () => {
    const { a } = await seedCreator();
    await db.insert(schema.creatorAccounts).values({ creatorId: a.creatorId, platform: "youtube", handle: "@other", externalId: "UCbbbbbbbbbbbbbbbbbbbbbb", verified: true });
    await db.insert(schema.creatorAccounts).values({ creatorId: a.creatorId, platform: "youtube", handle: "@third", externalId: "UCcccccccccccccccccccccc", verified: true });
    const r = await refreshAllCreators();
    expect(r).toHaveLength(2); // unverified @DukeDennis skipped
    expect(r[0].msg).toMatch(/YOUTUBE_API_KEY/);
    expect(r[1].msg).toMatch(/skipped/);
  });
});

describe("opportunity engine", () => {
  async function seedTrends() {
    const f = fakeFetch({ "trends.google.com": () => ({ body: TRENDS_XML }) });
    await ingestGoogleTrends({ fetchImpl: f.impl });
  }

  it("generates rules-based ideas when Claude is not configured, separating evidence and AI text", async () => {
    await seedTrends();
    const r = await generateOpportunities();
    expect(r.generator).toBe("rules");
    expect(r.created).toBeGreaterThan(0);
    const opps = await db.select().from(schema.opportunities);
    expect(opps.some((o) => /mortgage/.test(o.topic))).toBe(false); // irrelevant trend filtered
    for (const o of opps) {
      expect(o.totalScore).toBeGreaterThan(0);
      expect(o.totalScore).toBeLessThanOrEqual(100);
      expect(o.evidence.length).toBeGreaterThan(0);
      expect(o.evidence.every((e) => e.label)).toBe(true);
      expect(o.aiNotes).toBeTruthy();
    }
    const again = await generateOpportunities();
    expect(again.created).toBe(0); // same topics not re-suggested within 72h
  });

  it("uses Claude when available and records cost", async () => {
    await seedTrends();
    process.env.ANTHROPIC_API_KEY = "test";
    const client = {
      messages: {
        create: async (p: { messages: { content: string }[] }) => {
          const keys = [...p.messages[0].content.matchAll(/"topicKey":"([^"]+)"/g)].map((m) => m[1]);
          return {
            usage: { input_tokens: 1200, output_tokens: 800 },
            content: [{ type: "text", text: JSON.stringify({ ideas: keys.map((k) => ({ topicKey: k, title: `Idea for ${k}`, hook: "hook", concept: "concept text here", livestream: "", clips: [], platforms: ["TikTok"], production: "", whyFits: "AI says fits", aiNotes: "assumption", feasibility: 8, originality: 8, collaboration: 3 })) }) }],
          };
        },
      },
    };
    const r = await generateOpportunities({ client });
    expect(r.generator).toBe("claude");
    const [usage] = await db.select().from(schema.apiUsage).where(eq(schema.apiUsage.provider, "claude"));
    expect(usage.costUsd).toBeCloseTo((1200 * 0.1 + 800 * 0.5) / 1e6);
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("respects the monthly AI spending cap", async () => {
    await setSetting("ai", { ...DEFAULT_AI, monthlyCapUsd: 0.000001 });
    let called = false;
    const client = { messages: { create: async () => { called = true; return {}; } } };
    const out = await claudeIdeas([{ topicKey: "k", topic: "t", kind: "trend", evidence: [], matched: [], relevance: 1, freshness: 1, signals: { kinds: 1, items: 1, maxTraffic: null, maxOutlierRatio: null, bestConfidence: "none", manualOnly: false }, saturation: 0, creators: [], formats: [], preScore: 1 }], DEFAULT_PROFILE, { ...DEFAULT_AI, monthlyCapUsd: 0.000001 }, client);
    expect(out).toBeNull();
    expect(called).toBe(false);
  });

  it("builds a briefing even when providers are down", async () => {
    const b = await buildBriefing(new Date());
    expect(b.headline).toMatch(/No strong new opportunities/);
    expect(b.posting.basis).toBe("insufficient");
  });
});

describe("scheduled jobs", () => {
  it("fires the briefing at 8:00 AM Eastern, including across DST", () => {
    expect(dueSlot({ kind: "daily", at: "08:00" }, new Date("2026-11-23T13:00:00Z"))).toBe("2026-11-23@08:00"); // EST
    expect(dueSlot({ kind: "daily", at: "08:00" }, new Date("2026-11-23T12:59:00Z"))).toBeNull();
    expect(dueSlot({ kind: "daily", at: "08:00" }, new Date("2026-07-01T12:00:00Z"))).toBe("2026-07-01@08:00"); // EDT
    expect(dueSlot({ kind: "daily", at: "08:00" }, new Date("2026-11-23T18:00:00Z"))).toBeNull(); // past catch-up window
    expect(dueSlot({ kind: "weekly", weekday: 1, at: "09:00" }, new Date("2026-11-23T14:30:00Z"))).toBe("2026-11-23@09:00"); // Monday
  });

  it("runs each slot once, even across restarts", async () => {
    let n = 0;
    expect(await runJob("x", "s1", async () => { n++; })).toBe("ok");
    expect(await runJob("x", "s1", async () => { n++; })).toBe("skipped");
    expect(await runJob("x", "s2", async () => { throw new Error("boom"); })).toBe("error");
    expect(n).toBe(1);
    const rows = await db.select().from(schema.jobRuns);
    expect(rows.find((r) => r.slot === "s2")).toMatchObject({ status: "error", message: "boom" });
  });

  it("a scheduler tick survives every provider being unconfigured", async () => {
    const ran = await tick(new Date("2026-11-23T13:05:00Z")); // 8:05 AM ET Monday
    expect(ran.some((r) => r.startsWith("briefing:"))).toBe(true);
    expect(ran.every((r) => !r.endsWith(":error") || r.startsWith("trends"))).toBe(true);
    const [b] = await db.select().from(schema.briefings);
    expect(b.date).toBe("2026-11-23");
    expect(await tick(new Date("2026-11-23T13:06:00Z"))).not.toContain("briefing:ok");
  });
});

describe("notifications", () => {
  it("honors categories and quiet hours (test pushes always go)", () => {
    const s = { ...DEFAULT_NOTIFICATIONS, quietStart: "23:00", quietEnd: "08:00" };
    const lateNight = new Date("2026-11-24T05:00:00Z"); // midnight ET
    const noon = new Date("2026-11-23T17:00:00Z");
    expect(shouldSend("opportunity", s, lateNight)).toEqual({ send: false, reason: "quiet hours" });
    expect(shouldSend("opportunity", s, noon).send).toBe(true);
    expect(shouldSend("test", s, lateNight).send).toBe(true);
    expect(shouldSend("briefing", { ...s, categories: { ...s.categories, briefing: false } }, noon).send).toBe(false);
  });

  it("delivers to subscriptions and prunes expired ones", async () => {
    await db.insert(schema.pushSubscriptions).values([
      { endpoint: "https://push.test/ok", p256dh: "k", auth: "a" },
      { endpoint: "https://push.test/gone", p256dh: "k", auth: "a" },
    ]);
    const sender = async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith("gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
    };
    const r = await notify("test", { title: "t", body: "b" }, { sender });
    expect(r.sent).toBe(1);
    expect(await db.select().from(schema.pushSubscriptions)).toHaveLength(1);
    const [n] = await db.select().from(schema.notifications);
    expect(n.sent).toBe(true);
  });
});
