import { sql } from "drizzle-orm";
import { db, runMigrations } from "@/db";

let migrated = false;

export async function resetDb() {
  if (!migrated) { await runMigrations(); migrated = true; }
  const rows = await db.execute(sql`select tablename from pg_tables where schemaname = 'public' and tablename <> '__drizzle_migrations'`);
  const names = (rows.rows as { tablename: string }[]).map((r) => `"${r.tablename}"`);
  if (names.length) await db.execute(sql.raw(`truncate ${names.join(", ")} restart identity cascade`));
}

/** Minimal Response-compatible fake for injected fetch. */
export function fakeFetch(routes: Record<string, (url: string, init?: RequestInit) => { status?: number; body: unknown; headers?: Record<string, string> }>) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response("not found", { status: 404 });
    const r = routes[key](url, init);
    const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body);
    return new Response(body, { status: r.status ?? 200, headers: r.headers });
  }) as typeof fetch;
  return { impl, calls };
}
