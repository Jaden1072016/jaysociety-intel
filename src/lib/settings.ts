import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

export type AudienceProfile = {
  summary: string;
  topics: Record<string, string[]>; // topic -> keywords
  musicArtists: string[];
  exclude: string[];
};

export type NotificationSettings = {
  categories: { opportunity: boolean; briefing: boolean; system: boolean };
  quietStart: string; // "23:00"
  quietEnd: string; // "08:00"
  opportunityThreshold: number; // 0-100 internal priority score
  maxOpportunityPushesPerDay: number;
};

export type AiSettings = {
  enabled: boolean;
  model: string;
  monthlyCapUsd: number;
  maxIdeasPerRun: number;
};

export type BudgetSettings = {
  youtubeDailyUnits: number;
  twitchDailyRequests: number;
  trendsRefreshMinutes: number;
  creatorRefreshHours: number;
};

export const DEFAULT_PROFILE: AudienceProfile = {
  summary:
    "Young adults into gaming, streaming culture, hip-hop and R&B, humor, internet culture, friendship content and lifestyle. Personality-driven, not gaming-only.",
  topics: {
    gaming: ["gta", "gta 6", "gta vi", "fortnite", "2k", "nba 2k", "madden", "call of duty", "cod", "warzone", "minecraft", "roblox", "playstation", "ps5", "xbox", "nintendo", "switch 2", "valorant", "fc 26", "game", "gaming", "rockstar"],
    streaming: ["twitch", "kick", "stream", "streamer", "subathon", "livestream", "youtube", "tiktok", "creator", "amp", "kai cenat", "duke dennis", "fanum", "plaqueboymax", "lacy", "stable ronaldo", "ddg", "raud", "ishowspeed", "adin ross"],
    music: ["album", "song", "single", "tour", "rapper", "rap", "hip hop", "hip-hop", "r&b", "rnb", "mixtape", "grammy", "bet awards", "billboard", "music video", "freestyle", "diss"],
    humor: ["meme", "funny", "prank", "roast", "skit", "challenge", "viral"],
    culture: ["sneaker", "jordan", "nike", "fashion", "drip", "dating", "relationship", "friends", "college", "nba", "nfl", "lebron", "super bowl"],
    lifestyle: ["gym", "workout", "fitness", "car", "travel", "food", "mukbang", "apartment", "vlog"],
  },
  musicArtists: ["drake", "j. cole", "j cole", "partynextdoor", "bryson tiller", "jhené aiko", "jhene aiko", "future", "nino paid", "h.e.r.", "sza", "kendrick", "travis scott", "lil baby", "21 savage", "gunna", "chris brown", "brent faiyaz"],
  exclude: ["obituary", "shooting", "killed", "election results", "stock price", "earthquake"],
};

export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  categories: { opportunity: true, briefing: true, system: false },
  quietStart: "23:30",
  quietEnd: "07:45",
  opportunityThreshold: 72,
  maxOpportunityPushesPerDay: 3,
};

export const DEFAULT_AI: AiSettings = {
  enabled: true,
  model: process.env.CLAUDE_MODEL || "claude-haiku-5-5",
  monthlyCapUsd: Number(process.env.AI_MONTHLY_CAP_USD ?? 2),
  maxIdeasPerRun: 6,
};

export const DEFAULT_BUDGETS: BudgetSettings = {
  youtubeDailyUnits: 3000,
  twitchDailyRequests: 2000,
  trendsRefreshMinutes: 30,
  creatorRefreshHours: 6,
};

const DEFAULTS = {
  audience_profile: DEFAULT_PROFILE,
  notifications: DEFAULT_NOTIFICATIONS,
  ai: DEFAULT_AI,
  budgets: DEFAULT_BUDGETS,
} as const;

type Key = keyof typeof DEFAULTS;
type ValueOf<K extends Key> = K extends "audience_profile" ? AudienceProfile
  : K extends "notifications" ? NotificationSettings
  : K extends "ai" ? AiSettings : BudgetSettings;

export async function getSetting<K extends Key>(key: K): Promise<ValueOf<K>> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
  const def = DEFAULTS[key] as unknown as ValueOf<K>;
  if (!row) return def;
  return { ...def, ...(row.value as object) } as ValueOf<K>;
}

export async function setSetting<K extends Key>(key: K, value: ValueOf<K>) {
  await db.insert(schema.settings).values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } });
}
