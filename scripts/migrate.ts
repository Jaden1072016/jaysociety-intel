import { closeDb, runMigrations } from "../src/db";
import { seedIfEmpty } from "../src/db/seed";

async function main() {
  await runMigrations();
  const seeded = await seedIfEmpty();
  console.log(`[migrate] done${seeded ? "; seeded starting watchlist (unconfirmed)" : ""}`);
  await closeDb();
}

main().catch((e) => { console.error("[migrate] failed", e); process.exit(1); });
