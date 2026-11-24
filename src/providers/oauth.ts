import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { fetchWithRetry, ProviderNotConfigured, type FetchLike } from "@/lib/ops";

export type OAuthProvider = "google" | "twitch";

export const OAUTH = {
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/yt-analytics.readonly"],
    idEnv: "GOOGLE_CLIENT_ID", secretEnv: "GOOGLE_CLIENT_SECRET",
  },
  twitch: {
    authUrl: "https://id.twitch.tv/oauth2/authorize",
    tokenUrl: "https://id.twitch.tv/oauth2/token",
    scopes: ["moderator:read:followers"],
    idEnv: "TWITCH_CLIENT_ID", secretEnv: "TWITCH_CLIENT_SECRET",
  },
} as const;

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function redirectUri(p: OAuthProvider) {
  return `${appUrl()}/api/oauth/${p}/callback`;
}

function clientCreds(p: OAuthProvider) {
  const c = OAUTH[p];
  const id = process.env[c.idEnv], secret = process.env[c.secretEnv];
  if (!id || !secret) throw new ProviderNotConfigured(p, `${c.idEnv} / ${c.secretEnv} not set`);
  return { id, secret };
}

export function authorizeUrl(p: OAuthProvider, state: string): string {
  const c = OAUTH[p];
  const { id } = clientCreds(p);
  const qs = new URLSearchParams({
    client_id: id, redirect_uri: redirectUri(p), response_type: "code", scope: c.scopes.join(" "), state,
  });
  if (p === "google") { qs.set("access_type", "offline"); qs.set("prompt", "consent"); qs.set("include_granted_scopes", "true"); }
  return `${c.authUrl}?${qs}`;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string | string[] };

async function tokenRequest(p: OAuthProvider, body: Record<string, string>, fetchImpl?: FetchLike): Promise<TokenResponse> {
  const { id, secret } = clientCreds(p);
  const res = await fetchWithRetry(OAUTH[p].tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...body }),
  }, { fetchImpl, retries: 1 });
  return res.json();
}

export async function exchangeCode(p: OAuthProvider, code: string, fetchImpl?: FetchLike) {
  const t = await tokenRequest(p, { code, grant_type: "authorization_code", redirect_uri: redirectUri(p) }, fetchImpl);
  await saveTokens(p, t);
  return t;
}

async function saveTokens(p: OAuthProvider, t: TokenResponse, keepRefresh?: string | null) {
  const values = {
    provider: p,
    accessToken: encrypt(t.access_token),
    refreshToken: t.refresh_token ? encrypt(t.refresh_token) : keepRefresh ?? null,
    expiresAt: t.expires_in ? new Date(Date.now() + (t.expires_in - 60) * 1000) : null,
    scope: Array.isArray(t.scope) ? t.scope.join(" ") : t.scope ?? null,
    lastError: null,
  };
  await db.insert(schema.oauthConnections).values(values)
    .onConflictDoUpdate({ target: schema.oauthConnections.provider, set: values });
}

/** Returns a valid access token, refreshing if needed. null when not connected. */
export async function accessToken(p: OAuthProvider, fetchImpl?: FetchLike): Promise<string | null> {
  const [row] = await db.select().from(schema.oauthConnections).where(eq(schema.oauthConnections.provider, p));
  if (!row) return null;
  if (!row.expiresAt || row.expiresAt.getTime() > Date.now()) return decrypt(row.accessToken);
  if (!row.refreshToken) return null;
  try {
    const t = await tokenRequest(p, { grant_type: "refresh_token", refresh_token: decrypt(row.refreshToken) }, fetchImpl);
    await saveTokens(p, t, row.refreshToken);
    return t.access_token;
  } catch (e) {
    await db.update(schema.oauthConnections).set({ lastError: `Refresh failed: ${(e as Error).message}`.slice(0, 400) })
      .where(eq(schema.oauthConnections.provider, p));
    throw e;
  }
}

export async function setConnectionAccount(p: OAuthProvider, accountId: string, accountName: string) {
  await db.update(schema.oauthConnections).set({ accountId, accountName }).where(eq(schema.oauthConnections.provider, p));
}

export async function disconnect(p: OAuthProvider) {
  await db.delete(schema.oauthConnections).where(eq(schema.oauthConnections.provider, p));
}
