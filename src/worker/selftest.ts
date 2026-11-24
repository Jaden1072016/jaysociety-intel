/**
 * Production self-test. Runs only when RUN_SELFTEST=1. Uses REAL providers and logs evidence
 * of what came back (counts, sample titles, URLs, link checks). Prints no secrets.
 * Output lines start with "[selftest]" so they're easy to filter in Railway logs.
 */
import { desc, eq, sql, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { runNow } from "@/jobs";
import { dueSlot } from "@/jobs/scheduler";
import { isConfigured } from "@/lib/config";
import { resolveAccount } from "@/ingest/creators";

const out = (s: string) => console.log(`[selftest] ${s}`);

async function checkLink(url: string): Promise<string> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const r = await fetch(url, { method: "GET", redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": "JaySocietyCreatorIntel/1.0 linkcheck" } });
    clearTimeout(t);
    return String(r.status);
  } catch (e) {
    return `error ${(e as Error).message.slice(0, 60)}`;
  }
}

function eightAmUtc(dateEt: string): string {
  // scan the day in 1-minute steps for the first instant the 08:00 daily slot is due
  const start = new Date(`${dateEt}T00:00:00Z`).getTime();
  for (let m = 0; m < 36 * 60; m++) {
    const d = new Date(start + m * 60_000);
    if (dueSlot({ kind: "daily", at: "08:00" }, d) === `${dateEt}@08:00`) return d.toISOString();
  }
  return "not found";
}

export async function runSelfTest() {
  out("=== START (real providers) ===");
  out(`configured: trends=yes youtube=${isConfigured("youtube_data")} twitch=${isConfigured("twitch_helix")} claude=${isConfigured("claude")} push=${isConfigured("web_push")} google_oauth=${isConfigured("youtube_analytics")}`);

  out(`job trends: ${await runNow("trends")}`);
  const [tc] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.trends).where(eq(schema.trends.source, "google_trends_rss"));
  out(`google trends rows: ${tc.n}`);
  const sample = await db.select().from(schema.trends).where(eq(schema.trends.source, "google_trends_rss")).orderBy(desc(schema.trends.relevance)).limit(5);
  for (const t of sample) out(`  trend "${t.title}" traffic=${t.approxTraffic} relevance=${t.relevance} news=${(t.news ?? []).length} firstNews=${t.news?.[0]?.url ?? "-"}`);
  const [twc] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.trends).where(eq(schema.trends.source, "twitch_top"));
  out(`twitch top-category rows: ${twc.n}`);

  // Resolve every account so the owner can confirm them in the UI (does NOT confirm anything).
  const accs = await db.select().from(schema.creatorAccounts);
  for (const a of accs.filter((x) => ["youtube", "twitch"].includes(x.platform))) {
    const r = await resolveAccount(a.id);
    const [after] = await db.select().from(schema.creatorAccounts).where(eq(schema.creatorAccounts.id, a.id));
    out(`  lookup ${a.platform} ${a.handle}: ${r ? `found "${after.displayName}" id=${after.externalId} followers=${after.followerCount ?? "n/a"}` : `not resolved: ${after.resolveError}`}`);
  }

  // Creator ingestion needs confirmed accounts. Test on CONFIRMED ones only.
  out(`job creators: ${await runNow("creators")}`);
  const [vc] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.videos).where(eq(schema.videos.source, "api"));
  out(`creator videos stored: ${vc.n}`);
  const vids = await db.select().from(schema.videos).where(isNotNull(schema.videos.accountId)).orderBy(desc(schema.videos.publishedAt)).limit(5);
  for (const v of vids) out(`  video ${v.platform} "${v.title.slice(0, 70)}" views=${v.latestViews} format=${v.format} perf=${v.perfRatio ?? "n/a"} (${v.perfConfidence}) ${v.url}`);

  out(`job opportunities: ${await runNow("opportunities")}`);
  const opps = await db.select().from(schema.opportunities).orderBy(desc(schema.opportunities.createdAt)).limit(5);
  out(`opportunities in db: ${opps.length} shown`);
  for (const o of opps) {
    out(`  idea "${o.title}" score=${o.totalScore} generator=${o.generator} evidence=${o.evidence.length}`);
    for (const e of o.evidence.filter((x) => x.url).slice(0, 2)) out(`    link ${await checkLink(e.url!)} ${e.url}`);
  }

  out(`job briefing: ${await runNow("briefing")}`);
  const [b] = await db.select().from(schema.briefings).orderBy(desc(schema.briefings.createdAt)).limit(1);
  out(`briefing saved for ${b?.date ?? "none"}`);

  for (const d of ["2026-11-24", "2027-03-13", "2027-03-14", "2027-03-15", "2027-11-06", "2027-11-07", "2027-11-08"]) out(`  8:00 AM ET on ${d} fires at ${eightAmUtc(d)}`);

  const status = await db.select().from(schema.providerStatus);
  for (const s of status) out(`  status ${s.provider}: lastSuccess=${s.lastSuccessAt?.toISOString() ?? "never"} failures=${s.consecutiveFailures}${s.consecutiveFailures ? ` lastError=${s.lastError}` : ""}`);
  const [subs] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.pushSubscriptions);
  out(`push devices subscribed: ${subs.n}`);
  out("=== END ===");
}
