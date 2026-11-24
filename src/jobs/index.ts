import { and, desc, eq, isNull, gte } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSetting } from "@/lib/settings";
import { log, pruneOps } from "@/lib/ops";
import { zonedParts, etDate } from "@/lib/time";
import { ingestGoogleTrends, ingestTwitchTop } from "@/ingest/trends";
import { refreshAllCreators } from "@/ingest/creators";
import { syncOwnTwitch, syncOwnYouTube } from "@/ingest/own";
import { generateOpportunities } from "@/engine/generate";
import { buildBriefing, saveBriefing } from "@/engine/briefing";
import { notify, opportunityPushesToday } from "@/notify/push";
import { dueSlot, type Schedule } from "./scheduler";

export type JobName = "trends" | "creators" | "own" | "opportunities" | "briefing" | "weekly" | "prune";

/** Run a job once per slot. Returns "skipped" if that slot already ran. Never throws. */
export async function runJob(job: string, slot: string, fn: () => Promise<string | void>): Promise<"ok" | "error" | "skipped"> {
  const claimed = await db.insert(schema.jobRuns).values({ job, slot, status: "running" })
    .onConflictDoNothing().returning({ id: schema.jobRuns.id });
  if (!claimed.length) return "skipped";
  const id = claimed[0].id;
  try {
    const msg = await fn();
    await db.update(schema.jobRuns).set({ status: "ok", finishedAt: new Date(), message: msg ? String(msg).slice(0, 500) : null }).where(eq(schema.jobRuns.id, id));
    return "ok";
  } catch (e) {
    const m = (e as Error).message ?? String(e);
    await db.update(schema.jobRuns).set({ status: "error", finishedAt: new Date(), message: m.slice(0, 500) }).where(eq(schema.jobRuns.id, id));
    await log(`job:${job}`, "error", m);
    return "error";
  }
}

/** Each task is isolated: one provider failing doesn't stop the rest of the job. */
async function settle(parts: [string, () => Promise<unknown>][]): Promise<string> {
  const out: string[] = [];
  for (const [name, fn] of parts) {
    try {
      const r = await fn();
      out.push(`${name}: ok${r && typeof r === "object" && "inserted" in (r as object) ? ` (+${(r as { inserted: number }).inserted})` : ""}`);
    } catch (e) {
      out.push(`${name}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  return out.join("; ");
}

export const TASKS: Record<JobName, (now: Date) => Promise<string | void>> = {
  trends: () => settle([
    ["google_trends", () => ingestGoogleTrends()],
    ["twitch_top", () => (process.env.TWITCH_CLIENT_ID ? ingestTwitchTop() : Promise.resolve("not configured"))],
  ]),
  creators: async (now) => {
    const r = await refreshAllCreators({ now });
    return `${r.filter((x) => x.ok).length}/${r.length} accounts refreshed`;
  },
  own: () => settle([["youtube", () => syncOwnYouTube()], ["twitch", () => syncOwnTwitch()]]),
  opportunities: async (now) => {
    const r = await generateOpportunities({ now });
    const alerts = await alertHighScores(now);
    return `${r.created} new (${r.generator}); ${alerts} alerts`;
  },
  briefing: async (now) => {
    const pre = await settle([
      ["trends", () => ingestGoogleTrends()],
      ["opportunities", () => generateOpportunities({ now })],
    ]);
    const b = await buildBriefing(now);
    await saveBriefing(b);
    const n = await notify("briefing", { title: "Morning briefing ready", body: b.headline, url: "/" }, { now });
    await db.update(schema.briefings).set({ notifiedAt: n.sent ? new Date() : null }).where(eq(schema.briefings.date, b.date));
    return `${pre}; briefing saved; push ${n.sent ? "sent" : n.reason}`;
  },
  weekly: async (now) => {
    const n = await notify("briefing", { title: "Weekly review ready", body: "See which formats earned more of your time this week.", url: "/review" }, { now });
    return `push ${n.sent ? "sent" : n.reason}`;
  },
  prune: async () => { await pruneOps(); return "pruned"; },
};

/** Push for new opportunities above your threshold, capped per day. Score is an internal estimate. */
export async function alertHighScores(now = new Date()) {
  const s = await getSetting("notifications");
  const p = zonedParts(now);
  const dayStart = new Date(now.getTime() - (p.hour * 60 + p.minute) * 60_000);
  let remaining = s.maxOpportunityPushesPerDay - (await opportunityPushesToday(dayStart));
  if (remaining <= 0) return 0;
  const fresh = await db.select().from(schema.opportunities)
    .where(and(isNull(schema.opportunities.notifiedAt), eq(schema.opportunities.status, "new"), gte(schema.opportunities.createdAt, new Date(now.getTime() - 6 * 3_600_000))))
    .orderBy(desc(schema.opportunities.totalScore)).limit(5);
  let sent = 0;
  for (const o of fresh) {
    if (o.totalScore < s.opportunityThreshold || remaining <= 0) break;
    const r = await notify("opportunity", { title: `High-fit idea: ${o.title}`.slice(0, 90), body: o.hook.slice(0, 160), url: `/#opp-${o.id}` }, { now });
    await db.update(schema.opportunities).set({ notifiedAt: now }).where(eq(schema.opportunities.id, o.id));
    if (r.sent) { sent++; remaining--; }
  }
  return sent;
}

export async function schedules(): Promise<Record<JobName, Schedule>> {
  const b = await getSetting("budgets");
  const every = (h: number) => Array.from({ length: Math.floor(24 / h) }, (_, i) => `${String((1 + i * h) % 24).padStart(2, "0")}:00`);
  return {
    trends: { kind: "interval", minutes: Math.max(10, b.trendsRefreshMinutes) },
    creators: { kind: "times", at: every(Math.max(1, Math.min(24, b.creatorRefreshHours))) }, // 01:00, 07:00, ...
    own: { kind: "times", at: ["06:30", "18:30"] },
    opportunities: { kind: "times", at: ["11:00", "14:00", "17:00", "20:00"] },
    briefing: { kind: "daily", at: "08:00" },
    weekly: { kind: "weekly", weekday: 1, at: "09:00" },
    prune: { kind: "daily", at: "03:30" },
  };
}

/** One scheduler tick: run whatever is due, sequentially (cheap and avoids API bursts). */
export async function tick(now = new Date()) {
  const sch = await schedules();
  const ran: string[] = [];
  for (const [job, s] of Object.entries(sch) as [JobName, Schedule][]) {
    const slot = dueSlot(s, now);
    if (!slot) continue;
    const r = await runJob(job, slot, () => TASKS[job](now));
    if (r !== "skipped") ran.push(`${job}:${r}`);
  }
  return ran;
}

export async function runNow(job: JobName) {
  return runJob(job, `manual:${etDate()}:${Date.now()}`, () => TASKS[job](new Date()));
}
