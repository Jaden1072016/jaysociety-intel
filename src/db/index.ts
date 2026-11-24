import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import path from "node:path";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;

const g = globalThis as unknown as { __jayPool?: Pool; __jayDb?: DB };

export function getPool(): Pool {
  if (!g.__jayPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const ssl = /sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined;
    g.__jayPool = new Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 5), ssl });
  }
  return g.__jayPool;
}

export function getDb(): DB {
  if (!g.__jayDb) g.__jayDb = drizzle(getPool(), { schema });
  return g.__jayDb;
}

/** Lazy proxy so modules can `import { db }` without connecting at import time. */
export const db: DB = new Proxy({} as DB, {
  get(_t, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

const MIGRATION_LOCK = 724_310_991; // arbitrary constant shared by web + worker

/** Web and worker both migrate on boot; an advisory lock makes them take turns. */
export async function runMigrations() {
  const client = await getPool().connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await migrate(getDb(), { migrationsFolder: path.join(process.cwd(), "drizzle") });
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => {});
    client.release();
  }
}

export async function closeDb() {
  if (g.__jayPool) await g.__jayPool.end();
  g.__jayPool = undefined;
  g.__jayDb = undefined;
}

export { schema };
