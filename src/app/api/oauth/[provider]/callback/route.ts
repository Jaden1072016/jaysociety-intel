import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { isAuthed } from "@/lib/auth";
import { appUrl, exchangeCode, type OAuthProvider } from "@/providers/oauth";
import { syncOwnTwitch, syncOwnYouTube } from "@/ingest/own";
import { log } from "@/lib/ops";

const back = (msg: string) => NextResponse.redirect(`${appUrl()}/settings?msg=${encodeURIComponent(msg)}#connections`);

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  if (!(await isAuthed())) return NextResponse.redirect(`${appUrl()}/login`);
  const { provider } = await params;
  if (provider !== "google" && provider !== "twitch") return back("Unknown provider");
  const url = new URL(req.url);
  const jar = await cookies();
  const expected = jar.get(`oauth_state_${provider}`)?.value ?? "";
  jar.delete(`oauth_state_${provider}`);
  const got = url.searchParams.get("state") ?? "";
  if (!expected || expected.length !== got.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(got))) return back("Connection check failed (state mismatch). Try again.");
  if (url.searchParams.get("error")) return back(`Not connected: ${url.searchParams.get("error")}`);
  const code = url.searchParams.get("code");
  if (!code) return back("No authorization code returned");
  try {
    await exchangeCode(provider as OAuthProvider, code);
  } catch (e) {
    await log(provider, "error", `OAuth exchange failed: ${(e as Error).message}`);
    return back("Couldn't finish connecting. See Settings > Error log.");
  }
  // First sync in the background of this request; failures are logged and visible in Settings.
  const sync = provider === "google" ? syncOwnYouTube() : syncOwnTwitch();
  await sync.catch(() => undefined);
  return back(`${provider === "google" ? "YouTube" : "Twitch"} connected`);
}
