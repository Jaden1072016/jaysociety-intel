/**
 * Background worker. Run as a separate Railway service: `npm run worker`.
 * Ticks every minute; each job runs at most once per scheduled slot (enforced in Postgres).
 */
import { closeDb, runMigrations } from "@/db";
import { tick } from "@/jobs";

let stopping = false;

async function main() {
  await runMigrations();
  console.log("[worker] started; schedules in America/New_York");
  while (!stopping) {
    const started = Date.now();
    try {
      const ran = await tick(new Date());
      if (ran.length) console.log(`[worker] ${new Date().toISOString()} ${ran.join(", ")}`);
    } catch (e) {
      console.error("[worker] tick failed", e); // DB blip etc.; try again next minute
    }
    const wait = Math.max(5_000, 60_000 - (Date.now() - started));
    await new Promise((r) => setTimeout(r, wait));
  }
  await closeDb();
}

for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { stopping = true; console.log(`[worker] ${sig}, finishing current tick`); });

main().catch((e) => { console.error(e); process.exit(1); });
