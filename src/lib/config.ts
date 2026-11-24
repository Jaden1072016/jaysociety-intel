import type { ProviderId } from "./ops";

/** Whether a provider has the env it needs. Never returns secret values. */
export function isConfigured(p: ProviderId | string): boolean {
  const e = process.env;
  switch (p) {
    case "google_trends_rss": return true;
    case "youtube_data": return Boolean(e.YOUTUBE_API_KEY);
    case "youtube_analytics": return Boolean(e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET);
    case "twitch_helix": return Boolean(e.TWITCH_CLIENT_ID && e.TWITCH_CLIENT_SECRET);
    case "twitch_user": return Boolean(e.TWITCH_CLIENT_ID && e.TWITCH_CLIENT_SECRET);
    case "claude": return Boolean(e.ANTHROPIC_API_KEY);
    case "web_push": return Boolean(e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY);
    default: return false;
  }
}

export const SETUP_HINT: Record<string, string> = {
  youtube_data: "Set YOUTUBE_API_KEY (Google Cloud Console, enable YouTube Data API v3).",
  youtube_analytics: "Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, then Connect YouTube below.",
  twitch_helix: "Set TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET (dev.twitch.tv console).",
  twitch_user: "Uses the Twitch app credentials, then Connect Twitch below.",
  claude: "Optional. Set ANTHROPIC_API_KEY. Without it, ideas use the rules generator.",
  web_push: "Set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (run `npm run vapid`).",
  tiktok_creative_center: "No API. Use Import.",
  tiktok_search_insights: "No API. Use Import.",
  youtube_studio_trends: "No API. Use Import.",
  tiktok_display: "Needs a TikTok developer app with Login Kit and app review. Not wired yet.",
  instagram: "Needs a Meta app with Instagram API and app review. Not wired yet.",
  x_api: "Paid pay-per-use. Off until you approve the cost. Use Import for X links.",
};
