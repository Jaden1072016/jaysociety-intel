import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { isAuthed } from "@/lib/auth";
import { authorizeUrl, type OAuthProvider } from "@/providers/oauth";

export async function GET(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  if (!(await isAuthed())) return NextResponse.redirect(new URL("/login", process.env.APP_URL ?? "http://localhost:3000"));
  const { provider } = await params;
  if (provider !== "google" && provider !== "twitch") return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  const state = randomBytes(24).toString("base64url");
  (await cookies()).set(`oauth_state_${provider}`, state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/" });
  try {
    return NextResponse.redirect(authorizeUrl(provider as OAuthProvider, state));
  } catch (e) {
    return NextResponse.redirect(new URL(`/settings?msg=${encodeURIComponent((e as Error).message)}`, process.env.APP_URL ?? "http://localhost:3000"));
  }
}
