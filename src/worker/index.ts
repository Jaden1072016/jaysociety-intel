/**
 * Background worker. On Railway this is the same repo with APP_ROLE=worker.
 * Ticks every minute; each job runs at most once per scheduled slot (enforced in Postgres).
 * Serves /api/health on $PORT so Railway's healthcheck (shared railway.json) passes, and
 * reports unhealthy if the loop has stalled.
 */
import http from "node:http";
import { closeDb, runMigrations } from "@/db";
import { seedIfEmpty } from "@/db/seed";
import { tick, runJob } from "@/jobs";
import { applyWatchlist, applyResearchList } from "@/jobs/watchlist";
import { runSelfTest } from "./selftest";

let stopping = false;
let lastTickAt = 0;
let lastTickOk = true;

function healthServer() {
  const port = Number(process.env.PORT ?? 0);
  if (!port) return;
  http.createServer((req, res) => {
    const fresh = Date.now() - lastTickAt < 5 * 60_000;
    const ok = req.url === "/api/health" && (lastTickAt === 0 || (fresh && lastTickOk));
    res.writeHead(req.url === "/api/health" ? (ok ? 200 : 503) : 404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok, role: "worker", lastTickAt: lastTickAt ? new Date(lastTickAt).toISOString() : null }));
  }).listen(port, () => console.log(`[worker] health on :${port}`));
}

async function main() {
  healthServer();
  await runMigrations();
  await seedIfEmpty();
  console.log("[worker] started; schedules in America/New_York");
  // One-time watchlist import; job_runs makes sure it only ever runs once.
  console.log(`[watchlist] ${await runJob("watchlist_import", "2026-11-23", applyWatchlist)}`);
  console.log(`[watchlist] ${await runJob("watchlist_import", "2026-11-23-research", applyResearchList)}`);
  let selfTestDone = process.env.RUN_SELFTEST !== "1";
  while (!stopping) {
    const started = Date.now();
    try {
      const ran = await tick(new Date());
      lastTickOk = true;
      if (ran.length) console.log(`[worker] ${new Date().toISOString()} ${ran.join(", ")}`);
    } catch (e) {
      lastTickOk = false;
      console.error("[worker] tick failed", e); // DB blip etc.; try again next minute
    }
    lastTickAt = Date.now();
    if (!selfTestDone) {
      selfTestDone = true;
      await runSelfTest().catch((e) => console.error("[selftest] crashed", e));
    }
    const wait = Math.max(5_000, 60_000 - (Date.now() - started));
    await new Promise((r) => setTimeout(r, wait));
  }
  await closeDb();
}

for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { stopping = true; console.log(`[worker] ${sig}, finishing current tick`); });

main().catch((e) => { console.error(e); process.exit(1); });
