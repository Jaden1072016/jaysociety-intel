import { fetchWithRetry, spendUnits, ProviderNotConfigured, type FetchLike } from "@/lib/ops";
import { ptDate } from "@/lib/time";
import { getSetting } from "@/lib/settings";
import { classifyFormat, parseIsoDuration } from "@/analysis/performance";

const BASE = "https://www.googleapis.com/youtube/v3";

export type YtChannel = {
  id: string; title: string; handle: string | null; subscribers: number | null;
  uploadsPlaylist: string | null; createdAt: string | null; url: string;
};

export type YtVideo = {
  externalId: string; url: string; title: string; description: string; publishedAt: Date;
  durationSec: number | null; format: string; thumbnail: string | null;
  views: number | null; likes: number | null; comments: number | null; channelId: string;
};

type Opts = { fetchImpl?: FetchLike; apiKey?: string; bearer?: string; skipBudget?: boolean };

async function ytGet(path: string, params: Record<string, string>, units: number, opts: Opts = {}) {
  const key = opts.apiKey ?? process.env.YOUTUBE_API_KEY;
  if (!key && !opts.bearer) throw new ProviderNotConfigured("youtube_data", "YOUTUBE_API_KEY is not set");
  if (!opts.skipBudget) {
    const cap = (await getSetting("budgets")).youtubeDailyUnits;
    await spendUnits("youtube_data", ptDate(), units, cap); // quota resets at midnight Pacific
  }
  const qs = new URLSearchParams(params);
  if (!opts.bearer && key) qs.set("key", key);
  const res = await fetchWithRetry(`${BASE}/${path}?${qs}`, {
    headers: opts.bearer ? { Authorization: `Bearer ${opts.bearer}` } : {},
  }, { fetchImpl: opts.fetchImpl });
  return res.json() as Promise<{ items?: Record<string, any>[]; nextPageToken?: string }>;
}

/** Accepts @handle, handle, channel URL, /channel/UC... id. Returns lookup params for channels.list. */
export function channelLookup(input: string): { forHandle: string } | { id: string } {
  const s = input.trim();
  const idMatch = /(UC[\w-]{22})/.exec(s);
  if (idMatch) return { id: idMatch[1] };
  const h = /youtube\.com\/@([\w.\-]+)/i.exec(s)?.[1] ?? s.replace(/^@/, "");
  return { forHandle: "@" + h };
}

export function parseChannel(item: Record<string, any>): YtChannel {
  const handle = item.snippet?.customUrl ?? null;
  return {
    id: item.id,
    title: item.snippet?.title ?? "",
    handle,
    subscribers: item.statistics?.hiddenSubscriberCount ? null : toInt(item.statistics?.subscriberCount),
    uploadsPlaylist: item.contentDetails?.relatedPlaylists?.uploads ?? null,
    createdAt: item.snippet?.publishedAt ?? null,
    url: handle ? `https://www.youtube.com/${handle}` : `https://www.youtube.com/channel/${item.id}`,
  };
}

export async function resolveChannel(input: string, opts: Opts = {}): Promise<YtChannel | null> {
  const data = await ytGet("channels", { part: "snippet,statistics,contentDetails", ...channelLookup(input) }, 1, opts);
  const item = data.items?.[0];
  return item ? parseChannel(item) : null;
}

export async function myChannel(bearer: string, opts: Opts = {}): Promise<YtChannel | null> {
  const data = await ytGet("channels", { part: "snippet,statistics,contentDetails", mine: "true" }, 1, { ...opts, bearer });
  const item = data.items?.[0];
  return item ? parseChannel(item) : null;
}

/** Latest upload ids from the channel's uploads playlist (1 unit per page of 50). */
export async function recentUploadIds(playlistId: string, max = 50, opts: Opts = {}): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < max) {
    const data = await ytGet("playlistItems", {
      part: "contentDetails", playlistId, maxResults: String(Math.min(50, max - ids.length)),
      ...(pageToken ? { pageToken } : {}),
    }, 1, opts);
    for (const it of data.items ?? []) if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId);
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return ids;
}

export function parseVideo(item: Record<string, any>): YtVideo {
  const durationSec = parseIsoDuration(item.contentDetails?.duration);
  const title = item.snippet?.title ?? "";
  const thumbs = item.snippet?.thumbnails ?? {};
  return {
    externalId: item.id,
    url: `https://www.youtube.com/watch?v=${item.id}`,
    title,
    description: item.snippet?.description ?? "",
    publishedAt: new Date(item.snippet?.publishedAt),
    durationSec,
    format: classifyFormat("youtube", durationSec, { liveBroadcast: Boolean(item.liveStreamingDetails?.actualStartTime), title }),
    thumbnail: thumbs.medium?.url ?? thumbs.default?.url ?? null,
    views: toInt(item.statistics?.viewCount),
    likes: toInt(item.statistics?.likeCount),
    comments: toInt(item.statistics?.commentCount),
    channelId: item.snippet?.channelId ?? "",
  };
}

/** videos.list in batches of 50 (1 unit per batch). */
export async function getVideos(ids: string[], opts: Opts = {}): Promise<YtVideo[]> {
  const out: YtVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const data = await ytGet("videos", {
      part: "snippet,contentDetails,statistics,liveStreamingDetails", id: ids.slice(i, i + 50).join(","), maxResults: "50",
    }, 1, opts);
    for (const it of data.items ?? []) out.push(parseVideo(it));
  }
  return out;
}

export function videoIdFromUrl(url: string): string | null {
  const m = /(?:youtu\.be\/|v=|\/shorts\/|\/live\/|\/embed\/)([\w-]{11})/.exec(url);
  return m ? m[1] : null;
}

function toInt(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
