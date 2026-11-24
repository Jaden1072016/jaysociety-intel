import { cacheGet, cacheSet, fetchWithRetry, spendUnits, ProviderNotConfigured, type FetchLike } from "@/lib/ops";
import { etDate } from "@/lib/time";
import { getSetting } from "@/lib/settings";
import { classifyFormat, parseTwitchDuration } from "@/analysis/performance";

const HELIX = "https://api.twitch.tv/helix";

type Opts = { fetchImpl?: FetchLike; skipBudget?: boolean; userToken?: string };

function creds() {
  const id = process.env.TWITCH_CLIENT_ID, secret = process.env.TWITCH_CLIENT_SECRET;
  if (!id || !secret) throw new ProviderNotConfigured("twitch_helix", "TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET not set");
  return { id, secret };
}

/** Client-credentials app token, cached until shortly before expiry. Server-side only. */
export async function appToken(opts: Opts = {}): Promise<string> {
  const cached = await cacheGet<{ token: string }>("twitch_app_token");
  if (cached) return cached.token;
  const { id, secret } = creds();
  const res = await fetchWithRetry("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: "client_credentials" }),
  }, { fetchImpl: opts.fetchImpl });
  const j = await res.json() as { access_token: string; expires_in: number };
  await cacheSet("twitch_app_token", { token: j.access_token }, Math.max(60, j.expires_in - 3600));
  return j.access_token;
}

export async function helix<T = any>(path: string, params: [string, string][], opts: Opts = {}): Promise<{ data: T[]; pagination?: { cursor?: string }; total?: number }> {
  const { id } = creds();
  if (!opts.skipBudget) {
    const cap = (await getSetting("budgets")).twitchDailyRequests;
    await spendUnits("twitch_helix", etDate(), 1, cap);
  }
  const token = opts.userToken ?? await appToken(opts);
  const qs = new URLSearchParams(params);
  const res = await fetchWithRetry(`${HELIX}/${path}?${qs}`, {
    headers: { "Client-Id": id, Authorization: `Bearer ${token}` },
  }, { fetchImpl: opts.fetchImpl });
  return res.json();
}

export type TwitchUser = { id: string; login: string; displayName: string; createdAt: string; url: string };

export function loginFromInput(input: string): string {
  return (/twitch\.tv\/([\w]+)/i.exec(input)?.[1] ?? input).replace(/^@/, "").toLowerCase().trim();
}

export async function resolveUser(input: string, opts: Opts = {}): Promise<TwitchUser | null> {
  const r = await helix<{ id: string; login: string; display_name: string; created_at: string }>("users", [["login", loginFromInput(input)]], opts);
  const u = r.data[0];
  return u ? { id: u.id, login: u.login, displayName: u.display_name, createdAt: u.created_at, url: `https://www.twitch.tv/${u.login}` } : null;
}

export type TwitchVideo = {
  externalId: string; url: string; title: string; publishedAt: Date; durationSec: number | null;
  format: string; thumbnail: string | null; views: number | null; type: string;
};

export function parseTwitchVideo(v: Record<string, any>): TwitchVideo {
  const durationSec = parseTwitchDuration(v.duration);
  return {
    externalId: String(v.id),
    url: v.url,
    title: v.title ?? "",
    publishedAt: new Date(v.published_at ?? v.created_at),
    durationSec,
    format: classifyFormat("twitch", durationSec, { twitchType: v.type }),
    thumbnail: v.thumbnail_url ? String(v.thumbnail_url).replace("%{width}", "320").replace("%{height}", "180") : null,
    views: typeof v.view_count === "number" ? v.view_count : null,
    type: v.type,
  };
}

export async function userVideos(userId: string, first = 50, opts: Opts = {}): Promise<TwitchVideo[]> {
  const r = await helix("videos", [["user_id", userId], ["first", String(first)], ["sort", "time"]], opts);
  return r.data.map(parseTwitchVideo);
}

export async function liveStreams(userIds: string[], opts: Opts = {}) {
  if (!userIds.length) return [];
  const r = await helix<{ user_id: string; user_login: string; game_name: string; title: string; viewer_count: number; started_at: string }>(
    "streams", userIds.slice(0, 100).map((id) => ["user_id", id] as [string, string]), opts);
  return r.data;
}

export async function topCategories(first = 30, opts: Opts = {}) {
  const r = await helix<{ id: string; name: string }>("games/top", [["first", String(first)]], opts);
  return r.data;
}

export async function followerTotal(broadcasterId: string, userToken: string, opts: Opts = {}): Promise<number | null> {
  const r = await helix("channels/followers", [["broadcaster_id", broadcasterId], ["first", "1"]], { ...opts, userToken });
  return typeof r.total === "number" ? r.total : null;
}
