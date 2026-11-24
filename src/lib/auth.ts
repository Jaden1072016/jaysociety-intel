import bcrypt from "bcryptjs";
import { timingSafeEqual } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { SESSION_COOKIE, SESSION_DAYS, createSessionToken, verifySessionToken } from "./session";

export const MAX_FAILURES = 5;
export const LOCKOUT_MINUTES = 15;

/**
 * Checks a password against APP_PASSWORD_HASH (bcrypt, preferred) or APP_PASSWORD (plain env secret).
 * Comparison is constant-time for the plain variant.
 */
export async function checkPassword(input: string, env = process.env): Promise<boolean> {
  if (!input) return false;
  if (env.APP_PASSWORD_HASH) return bcrypt.compare(input, env.APP_PASSWORD_HASH);
  const expected = env.APP_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(input), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Failures across ALL addresses. Stops someone rotating IPs to guess the password. */
export const GLOBAL_MAX_FAILURES = 30;

export async function recentFailures(ip: string | null, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - LOCKOUT_MINUTES * 60_000);
  const conds = [eq(schema.loginAttempts.success, false), gte(schema.loginAttempts.createdAt, since)];
  if (ip !== null) conds.push(eq(schema.loginAttempts.ip, ip));
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.loginAttempts).where(and(...conds));
  return row?.n ?? 0;
}

export type LoginResult = { ok: true; token: string } | { ok: false; error: string };

/** Pure-ish login flow (DB for rate limiting) so it can be tested without Next request context. */
export async function attemptLogin(ip: string, password: string): Promise<LoginResult> {
  if ((await recentFailures(ip)) >= MAX_FAILURES || (await recentFailures(null)) >= GLOBAL_MAX_FAILURES) {
    return { ok: false, error: `Too many attempts. Try again in ${LOCKOUT_MINUTES} minutes.` };
  }
  const ok = await checkPassword(password);
  await db.insert(schema.loginAttempts).values({ ip, success: ok });
  if (!ok) return { ok: false, error: "Wrong password." };
  return { ok: true, token: await createSessionToken() };
}

/**
 * The client can put anything in X-Forwarded-For; Railway's edge appends the real address last.
 * So the rightmost entry is the one we trust.
 */
export function ipFromForwarded(xff: string | null, realIp: string | null): string {
  const parts = (xff ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return parts.at(-1) ?? realIp?.trim() ?? "unknown";
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return ipFromForwarded(h.get("x-forwarded-for"), h.get("x-real-ip"));
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
    path: "/", maxAge: SESSION_DAYS * 86400,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function isAuthed(): Promise<boolean> {
  return verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/** Call at the top of every server action and route handler. Middleware is not the only guard. */
export async function requireAuth() {
  if (!(await isAuthed())) redirect("/login");
}
