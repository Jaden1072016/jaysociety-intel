import { fetchWithRetry, type FetchLike } from "@/lib/ops";

const BASE = "https://youtubeanalytics.googleapis.com/v2/reports";

export type AnalyticsTable = { columnHeaders: { name: string }[]; rows?: (string | number)[][] };

export function tableToObjects(t: AnalyticsTable): Record<string, string | number>[] {
  const names = t.columnHeaders.map((c) => c.name);
  return (t.rows ?? []).map((r) => Object.fromEntries(r.map((v, i) => [names[i], v])));
}

async function report(bearer: string, params: Record<string, string>, fetchImpl?: FetchLike): Promise<AnalyticsTable> {
  const qs = new URLSearchParams({ ids: "channel==MINE", ...params });
  const res = await fetchWithRetry(`${BASE}?${qs}`, { headers: { Authorization: `Bearer ${bearer}` } }, { fetchImpl });
  return res.json();
}

export const VIDEO_METRICS = ["views", "averageViewDuration", "averageViewPercentage", "subscribersGained", "subscribersLost", "likes", "comments", "shares"];

/** Per-video totals for the window (max 200 rows, sorted by views as the API requires). */
export async function perVideo(bearer: string, startDate: string, endDate: string, fetchImpl?: FetchLike) {
  const t = await report(bearer, {
    startDate, endDate, dimensions: "video", metrics: VIDEO_METRICS.join(","), sort: "-views", maxResults: "200",
  }, fetchImpl);
  return tableToObjects(t);
}

export async function daily(bearer: string, startDate: string, endDate: string, fetchImpl?: FetchLike) {
  const t = await report(bearer, {
    startDate, endDate, dimensions: "day", sort: "day",
    metrics: "views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost",
  }, fetchImpl);
  return tableToObjects(t);
}
