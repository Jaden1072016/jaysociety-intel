import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";

export const PROVIDERS = {
  google_trends_rss: { label: "Google Trends (Trending now RSS)", supportLevel: "full" },
  youtube_data: { label: "YouTube Data API", supportLevel: "full" },
  youtube_analytics: { label: "YouTube Analytics (your channel)", supportLevel: "full" },
  twitch_helix: { label: "Twitch API", supportLevel: "full" },
  twitch_user: { label: "Twitch (your followers)", supportLevel: "partial" },
  claude: { label: "Claude idea generation", supportLevel: "optional" },
  web_push: { label: "Push notifications", supportLevel: "full" },
  tiktok_creative_center: { label: "TikTok Creative Center", supportLevel: "manual" },
  tiktok_search_insights: { label: "TikTok Creator Search Insights", supportLevel: "manual" },
  tiktok_display: { label: "TikTok (your videos)", supportLevel: "partial" },
  instagram: { label: "Instagram insights", supportLevel: "partial" },
  youtube_studio_trends: { label: "YouTube Studio Trends", supportLevel: "manual" },
  x_api: { label: "X API", supportLevel: "not_built" },
} as const;

export type ProviderId = keyof typeof PROVIDERS;

export class BudgetExceeded extends Error {
  constructor(public provider: string, msg: string) { super(msg); this.name = "BudgetExceeded"; }
}

export class ProviderNotConfigured extends Error {
  constructor(public provider: string, msg: string) { super(msg); this.name = "ProviderNotConfigured"; }
}

export async function log(provider: string, level: "info" | "warn" | "error", message: string) {
  try {
    await db.insert(schema.providerLogs).values({ provider, level, message: message.slice(0, 2000) });
  } catch (e) {
    console.error("[log failed]", provider, message, e);
  }
  (level === "error" ? console.error : console.log)(`[${provider}] ${message}`);
}

async function ensureStatus(provider: string) {
  const meta = PROVIDERS[provider as ProviderId];
  await db.insert(schema.providerStatus)
    .values({ provider, supportLevel: meta?.supportLevel ?? "full" })
    .onConflictDoNothing();
}

export async function recordSuccess(provider: string, note?: string) {
  await ensureStatus(provider);
  await db.update(schema.providerStatus)
    .set({ lastSuccessAt: new Date(), consecutiveFailures: 0, ...(note !== undefined ? { note } : {}) })
    .where(eq(schema.providerStatus.provider, provider));
}

export async function recordFailure(provider: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  await ensureStatus(provider);
  await db.update(schema.providerStatus)
    .set({
      lastErrorAt: new Date(), lastError: msg.slice(0, 500),
      consecutiveFailures: sql`${schema.providerStatus.consecutiveFailures} + 1`,
    })
    .where(eq(schema.providerStatus.provider, provider));
  await log(provider, err instanceof BudgetExceeded ? "warn" : "error", msg);
}

export async function setProviderNote(provider: string, note: string) {
  await ensureStatus(provider);
  await db.update(schema.providerStatus).set({ note }).where(eq(schema.providerStatus.provider, provider));
}

/** Adds usage and throws BudgetExceeded if it would go past the cap. Call BEFORE the request. */
export async function spendUnits(provider: string, day: string, units: number, cap: number) {
  const [row] = await db.insert(schema.apiUsage).values({ provider, day, units: 0, requests: 0 })
    .onConflictDoUpdate({ target: [schema.apiUsage.provider, schema.apiUsage.day], set: { provider } })
    .returning();
  if (row.units + units > cap) {
    throw new BudgetExceeded(provider, `${provider} daily budget reached (${row.units}/${cap}). Skipping until reset.`);
  }
  await db.update(schema.apiUsage)
    .set({ units: sql`${schema.apiUsage.units} + ${units}`, requests: sql`${schema.apiUsage.requests} + 1` })
    .where(and(eq(schema.apiUsage.provider, provider), eq(schema.apiUsage.day, day)));
}

export async function addCost(provider: string, day: string, costUsd: number) {
  await db.insert(schema.apiUsage).values({ provider, day, costUsd, requests: 1 })
    .onConflictDoUpdate({
      target: [schema.apiUsage.provider, schema.apiUsage.day],
      set: { costUsd: sql`${schema.apiUsage.costUsd} + ${costUsd}`, requests: sql`${schema.apiUsage.requests} + 1` },
    });
}

export async function monthCost(provider: string, monthPrefix: string): Promise<number> {
  const [r] = await db.select({ c: sql<number>`coalesce(sum(${schema.apiUsage.costUsd}),0)::float` })
    .from(schema.apiUsage)
    .where(and(eq(schema.apiUsage.provider, provider), sql`${schema.apiUsage.day} like ${monthPrefix + "%"}`));
  return r?.c ?? 0;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const [r] = await db.select().from(schema.cacheEntries)
    .where(and(eq(schema.cacheEntries.key, key), gt(schema.cacheEntries.expiresAt, new Date())));
  return (r?.value as T) ?? null;
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number) {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await db.insert(schema.cacheEntries).values({ key, value: value as object, expiresAt })
    .onConflictDoUpdate({ target: schema.cacheEntries.key, set: { value: value as object, expiresAt } });
}

export async function pruneOps() {
  const monthAgo = new Date(Date.now() - 30 * 86400_000);
  await db.delete(schema.cacheEntries).where(lt(schema.cacheEntries.expiresAt, new Date()));
  await db.delete(schema.providerLogs).where(lt(schema.providerLogs.createdAt, monthAgo));
  await db.delete(schema.loginAttempts).where(lt(schema.loginAttempts.createdAt, monthAgo));
}

export async function recentLogs(limit = 50) {
  return db.select().from(schema.providerLogs).orderBy(desc(schema.providerLogs.createdAt)).limit(limit);
}

// ---------- HTTP with timeout + retry ----------

export class HttpError extends Error {
  constructor(public status: number, public body: string, url: string) {
    super(`HTTP ${status} from ${new URL(url).host}${new URL(url).pathname}: ${body.slice(0, 300)}`);
    this.name = "HttpError";
  }
}

export type FetchLike = typeof fetch;

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: { retries?: number; timeoutMs?: number; fetchImpl?: FetchLike; baseDelayMs?: number } = {},
): Promise<Response> {
  const { retries = 2, timeoutMs = 20_000, fetchImpl = fetch, baseDelayMs = 800 } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.ok) return res;
      const body = await res.text().catch(() => "");
      const err = new HttpError(res.status, body, url);
      // Retry only on rate limiting and server errors. 4xx (bad key, quota) fail fast.
      if (res.status !== 429 && res.status < 500) throw err;
      lastErr = err;
      const ra = Number(res.headers.get("retry-after"));
      if (attempt < retries) await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 30) * 1000 : baseDelayMs * 2 ** attempt);
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof HttpError && e.status !== 429 && e.status < 500) throw e;
      lastErr = e;
      if (attempt < retries) await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
