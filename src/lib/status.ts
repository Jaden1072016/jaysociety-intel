import { db, schema } from "@/db";
import { isConfigured } from "./config";
import { PROVIDERS, type ProviderId } from "./ops";

const SHORT: Partial<Record<ProviderId, string>> = {
  google_trends_rss: "Google Trends", youtube_data: "YouTube", twitch_helix: "Twitch",
  youtube_analytics: "Your YouTube", claude: "Claude", web_push: "Push",
};

export async function providerStatuses(only?: ProviderId[]) {
  const rows = await db.select().from(schema.providerStatus);
  const ids = (only ?? (Object.keys(PROVIDERS) as ProviderId[]));
  return ids.map((p) => {
    const r = rows.find((x) => x.provider === p);
    return {
      provider: p, label: SHORT[p] ?? PROVIDERS[p].label, fullLabel: PROVIDERS[p].label, supportLevel: PROVIDERS[p].supportLevel,
      configured: isConfigured(p), lastSuccessAt: r?.lastSuccessAt ?? null, lastErrorAt: r?.lastErrorAt ?? null,
      consecutiveFailures: r?.consecutiveFailures ?? 0, lastError: r?.lastError ?? null, note: r?.note ?? null,
    };
  });
}
