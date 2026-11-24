/**
 * Creator-relative performance.
 *
 * A video's views are compared against the same creator's OTHER videos of the SAME format
 * that were observed at a SIMILAR age (0.5x to 2x of this video's age). We use snapshot
 * history when available, else each peer's current views only if that peer is also in the
 * age band. If too few peers exist, we widen to all same-format videos and lower confidence.
 *
 * This says "this video is doing unusually well for this creator", never WHY.
 */

export type PeerObs = { videoId: string; format: string; ageHours: number; views: number };
export type PerfResult = {
  ratio: number | null;
  baseline: number | null;
  peers: number;
  confidence: "high" | "medium" | "low" | "none";
  basis: string;
};

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** For each peer video pick the observation closest to targetAge, if within the band. */
function closestInBand(obs: PeerObs[], targetAge: number, lo: number, hi: number): Map<string, number> {
  const best = new Map<string, { d: number; views: number }>();
  for (const o of obs) {
    if (o.ageHours < lo || o.ageHours > hi) continue;
    const d = Math.abs(Math.log(o.ageHours / targetAge));
    const cur = best.get(o.videoId);
    if (!cur || d < cur.d) best.set(o.videoId, { d, views: o.views });
  }
  return new Map([...best].map(([k, v]) => [k, v.views]));
}

export function computePerformance(
  video: { id: string; format: string; ageHours: number; views: number | null },
  peerObservations: PeerObs[],
  minPeers = 5,
): PerfResult {
  if (video.views == null || video.ageHours <= 0) {
    return { ratio: null, baseline: null, peers: 0, confidence: "none", basis: "No view count available" };
  }
  const others = peerObservations.filter((o) => o.videoId !== video.id && o.views != null);
  const sameFormat = others.filter((o) => o.format === video.format);
  const age = Math.max(video.ageHours, 1);

  const banded = closestInBand(sameFormat, age, age * 0.5, age * 2);
  if (banded.size >= minPeers) {
    const base = median([...banded.values()])!;
    return {
      ratio: base > 0 ? round2(video.views / base) : null, baseline: Math.round(base), peers: banded.size,
      confidence: banded.size >= 12 ? "high" : "medium",
      basis: `vs ${banded.size} of their ${video.format} videos at a similar age`,
    };
  }

  // Fallback: per-video latest views of same-format videos, normalized by log-age.
  // Views are concave in age, so compare views per log(age) rather than raw totals.
  const latest = new Map<string, PeerObs>();
  for (const o of sameFormat) {
    const cur = latest.get(o.videoId);
    if (!cur || o.ageHours > cur.ageHours) latest.set(o.videoId, o);
  }
  const rates = [...latest.values()].map((o) => o.views / Math.log1p(Math.max(o.ageHours, 1)));
  if (rates.length >= Math.max(3, Math.floor(minPeers / 2))) {
    const baseRate = median(rates)!;
    const expected = baseRate * Math.log1p(age);
    return {
      ratio: expected > 0 ? round2(video.views / expected) : null, baseline: Math.round(expected), peers: rates.length,
      confidence: "low",
      basis: `age-adjusted estimate from ${rates.length} ${video.format} videos (not enough same-age history yet)`,
    };
  }
  return { ratio: null, baseline: null, peers: rates.length, confidence: "none", basis: "Not enough history for this creator and format yet" };
}

export function perfLabel(ratio: number | null, confidence: string): string {
  if (ratio == null || confidence === "none") return "Not enough history";
  const tag = confidence === "low" ? " (low confidence)" : "";
  if (ratio >= 3) return `${ratio}x their usual${tag}`;
  if (ratio >= 1.5) return `${ratio}x their usual${tag}`;
  if (ratio >= 0.75) return `About their usual${tag}`;
  return `Below their usual${tag}`;
}

/** Classify by duration and platform metadata. YouTube Shorts are <= 3 min since Oct 2024. */
export function classifyFormat(platform: string, durationSec: number | null, extra: { liveBroadcast?: boolean; twitchType?: string; title?: string } = {}): string {
  if (platform === "twitch") {
    if (extra.twitchType === "archive") return "live_vod";
    if (extra.twitchType === "highlight") return "highlight";
    return "upload";
  }
  if (platform === "youtube") {
    if (extra.liveBroadcast) return "live_vod";
    // The Data API has no "is Short" flag, so duration is the signal (Shorts can be up to 3 minutes).
    if (durationSec != null && durationSec <= 180) return "short";
    if (durationSec != null && durationSec >= 3 * 3600) return "live_vod";
    return durationSec == null ? "unknown" : "long";
  }
  if (platform === "tiktok" || platform === "instagram") return "short";
  return "unknown";
}

/** ISO 8601 duration (PT1H2M3S) -> seconds. */
export function parseIsoDuration(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s);
  if (!m) return null;
  const [, d, h, mi, se] = m.map((x) => Number(x ?? 0));
  return d * 86400 + h * 3600 + mi * 60 + se;
}

/** Twitch duration "3h2m1s" -> seconds. */
export function parseTwitchDuration(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(s);
  if (!m || !m[0]) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
