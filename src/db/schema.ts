import {
  pgTable, text, integer, boolean, timestamp, doublePrecision, jsonb, uniqueIndex, index, serial,
} from "drizzle-orm/pg-core";
import { createId } from "../lib/id";

const id = () => text("id").primaryKey().$defaultFn(createId);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const now = (name: string) => ts(name).notNull().defaultNow();

// ---------- Auth ----------
export const loginAttempts = pgTable("login_attempts", {
  id: serial("id").primaryKey(),
  ip: text("ip").notNull(),
  success: boolean("success").notNull(),
  createdAt: now("created_at"),
}, (t) => [index("login_attempts_ip_idx").on(t.ip, t.createdAt)]);

// ---------- Creators ----------
export const creators = pgTable("creators", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  isSelf: boolean("is_self").notNull().default(false),
  priority: integer("priority").notNull().default(2),
  active: boolean("active").notNull().default(true),
  disambiguation: text("disambiguation"),
  notes: text("notes"),
  tags: text("tags").array().notNull().default([]),
  createdAt: now("created_at"),
});

export const creatorAccounts = pgTable("creator_accounts", {
  id: id(),
  creatorId: text("creator_id").notNull().references(() => creators.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(), // youtube | twitch | tiktok | instagram | x | kick
  handle: text("handle").notNull(),
  url: text("url"),
  externalId: text("external_id"),
  displayName: text("display_name"),
  followerCount: integer("follower_count"),
  verified: boolean("verified").notNull().default(false),
  verifiedAt: ts("verified_at"),
  resolveError: text("resolve_error"),
  lastFetchedAt: ts("last_fetched_at"),
  uploadsPlaylist: text("uploads_playlist"),
  avatarUrl: text("avatar_url"),
  // Audit trail for how this account was identified
  role: text("role"), // Main | Live/secondary | VODs | Secondary vlog | ...
  confidence: text("confidence"), // High | Medium | Low
  trackingDecision: text("tracking_decision"), // "YES - ID confirm" | "HOLD - verify"
  verificationMethod: text("verification_method"),
  evidenceUrl: text("evidence_url"),
  caution: text("caution"),
  checkedAt: ts("checked_at"),
  approvedBy: text("approved_by"),
  createdAt: now("created_at"),
}, (t) => [uniqueIndex("creator_accounts_platform_handle").on(t.platform, t.handle)]);

export const videos = pgTable("videos", {
  id: id(),
  accountId: text("account_id").references(() => creatorAccounts.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  externalId: text("external_id").notNull(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  publishedAt: ts("published_at").notNull(),
  durationSec: integer("duration_sec"),
  format: text("format").notNull().default("unknown"), // short | long | live_vod | highlight | upload | unknown
  thumbnail: text("thumbnail"),
  source: text("source").notNull().default("api"), // api | manual
  isOwn: boolean("is_own").notNull().default(false),
  firstSeenAt: now("first_seen_at"),
  lastSnapshotAt: ts("last_snapshot_at"),
  latestViews: integer("latest_views"),
  latestLikes: integer("latest_likes"),
  latestComments: integer("latest_comments"),
  perfRatio: doublePrecision("perf_ratio"),
  perfConfidence: text("perf_confidence"),
  perfBasis: text("perf_basis"),
  formats: text("formats").array().notNull().default([]),
}, (t) => [
  uniqueIndex("videos_platform_external").on(t.platform, t.externalId),
  index("videos_account_published").on(t.accountId, t.publishedAt),
]);

export const videoSnapshots = pgTable("video_snapshots", {
  id: id(),
  videoId: text("video_id").notNull().references(() => videos.id, { onDelete: "cascade" }),
  capturedAt: now("captured_at"),
  ageHours: doublePrecision("age_hours").notNull(),
  views: integer("views"),
  likes: integer("likes"),
  comments: integer("comments"),
}, (t) => [index("video_snapshots_video").on(t.videoId, t.capturedAt)]);

// ---------- Trends ----------
export const trends = pgTable("trends", {
  id: id(),
  source: text("source").notNull(),
  key: text("key").notNull(),
  title: text("title").notNull(),
  url: text("url"),
  approxTraffic: text("approx_traffic"),
  trafficNum: integer("traffic_num"),
  publishedAt: ts("published_at"),
  firstSeenAt: now("first_seen_at"),
  lastSeenAt: now("last_seen_at"),
  seenCount: integer("seen_count").notNull().default(1),
  news: jsonb("news").$type<NewsItem[]>(),
  relevance: doublePrecision("relevance").notNull().default(0),
  matchedTopics: text("matched_topics").array().notNull().default([]),
  clusterKey: text("cluster_key"),
  supportLevel: text("support_level").notNull().default("full"),
  dismissed: boolean("dismissed").notNull().default(false),
}, (t) => [uniqueIndex("trends_source_key").on(t.source, t.key), index("trends_last_seen").on(t.lastSeenAt)]);

export type NewsItem = { title: string; url: string; source?: string };

// ---------- Opportunities / ideas / briefings ----------
export type Evidence = { kind: string; label: string; url?: string; metric?: string; observedAt?: string };
export type Scores = {
  audienceRelevance: number; freshness: number; evidenceStrength: number;
  feasibility: number; originality: number; collaboration: number;
};

export const opportunities = pgTable("opportunities", {
  id: id(),
  createdAt: now("created_at"),
  batchId: text("batch_id").notNull(),
  topic: text("topic").notNull(),
  topicKey: text("topic_key").notNull(),
  title: text("title").notNull(),
  hook: text("hook").notNull(),
  concept: text("concept").notNull(),
  livestream: text("livestream"),
  clips: text("clips").array().notNull().default([]),
  platforms: text("platforms").array().notNull().default([]),
  production: text("production"),
  whyFits: text("why_fits").notNull(),
  evidence: jsonb("evidence").$type<Evidence[]>().notNull(),
  aiNotes: text("ai_notes"),
  generator: text("generator").notNull(), // claude | rules
  scores: jsonb("scores").$type<Scores>().notNull(),
  totalScore: doublePrecision("total_score").notNull(),
  status: text("status").notNull().default("new"), // new | saved | dismissed
  notifiedAt: ts("notified_at"),
  ideaId: text("idea_id"),
}, (t) => [index("opps_created").on(t.createdAt), index("opps_topic").on(t.topicKey)]);

export const IDEA_STATUSES = ["Researching", "Ready to Film", "Recorded", "Edited", "Published", "Reviewed"] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
export type IdeaResults = {
  views?: number; likes?: number; comments?: number; follows?: number; avgWatchSec?: number;
  notes?: string; source?: "manual" | "youtube_analytics";
};

export const ideas = pgTable("ideas", {
  id: id(),
  title: text("title").notNull(),
  status: text("status").notNull().default("Researching"),
  format: text("format"),
  platforms: text("platforms").array().notNull().default([]),
  notes: text("notes"),
  script: text("script"),
  hook: text("hook"),
  sourceLinks: text("source_links").array().notNull().default([]),
  opportunityId: text("opportunity_id"),
  experimentId: text("experiment_id"),
  experimentArm: text("experiment_arm"),
  publishedUrl: text("published_url"),
  publishedAt: ts("published_at"),
  results: jsonb("results").$type<IdeaResults>(),
  createdAt: now("created_at"),
  updatedAt: now("updated_at"),
}, (t) => [index("ideas_status").on(t.status)]);

export const briefings = pgTable("briefings", {
  id: id(),
  date: text("date").notNull().unique(),
  content: jsonb("content").notNull(),
  createdAt: now("created_at"),
  notifiedAt: ts("notified_at"),
});

export const experiments = pgTable("experiments", {
  id: id(),
  name: text("name").notNull(),
  variable: text("variable").notNull(), // posting_window | format
  armA: text("arm_a").notNull(),
  armB: text("arm_b").notNull(),
  hypothesis: text("hypothesis"),
  status: text("status").notNull().default("running"),
  createdAt: now("created_at"),
  endedAt: ts("ended_at"),
});

// ---------- Own analytics ----------
export const oauthConnections = pgTable("oauth_connections", {
  provider: text("provider").primaryKey(), // google | twitch
  accountId: text("account_id"),
  accountName: text("account_name"),
  accessToken: text("access_token").notNull(), // encrypted
  refreshToken: text("refresh_token"), // encrypted
  expiresAt: ts("expires_at"),
  scope: text("scope"),
  connectedAt: now("connected_at"),
  lastError: text("last_error"),
});

export const ownVideoMetrics = pgTable("own_video_metrics", {
  id: id(),
  videoId: text("video_id").notNull().references(() => videos.id, { onDelete: "cascade" }),
  fetchedAt: now("fetched_at"),
  views: integer("views"),
  avgViewDurationSec: doublePrecision("avg_view_duration_sec"),
  avgViewPct: doublePrecision("avg_view_pct"),
  subscribersGained: integer("subscribers_gained"),
  subscribersLost: integer("subscribers_lost"),
  likes: integer("likes"),
  comments: integer("comments"),
  shares: integer("shares"),
}, (t) => [index("own_metrics_video").on(t.videoId, t.fetchedAt)]);

export const channelDaily = pgTable("channel_daily", {
  id: id(),
  platform: text("platform").notNull(),
  date: text("date").notNull(),
  metrics: jsonb("metrics").$type<Record<string, number | null>>().notNull(),
}, (t) => [uniqueIndex("channel_daily_platform_date").on(t.platform, t.date)]);

// ---------- Ops ----------
export const providerStatus = pgTable("provider_status", {
  provider: text("provider").primaryKey(),
  supportLevel: text("support_level").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastSuccessAt: ts("last_success_at"),
  lastErrorAt: ts("last_error_at"),
  lastError: text("last_error"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  note: text("note"),
});

export const providerLogs = pgTable("provider_logs", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  level: text("level").notNull(),
  message: text("message").notNull(),
  createdAt: now("created_at"),
}, (t) => [index("provider_logs_created").on(t.createdAt)]);

export const apiUsage = pgTable("api_usage", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  day: text("day").notNull(),
  units: integer("units").notNull().default(0),
  requests: integer("requests").notNull().default(0),
  costUsd: doublePrecision("cost_usd").notNull().default(0),
}, (t) => [uniqueIndex("api_usage_provider_day").on(t.provider, t.day)]);

export const cacheEntries = pgTable("cache_entries", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
});

export const jobRuns = pgTable("job_runs", {
  id: serial("id").primaryKey(),
  job: text("job").notNull(),
  slot: text("slot").notNull(),
  status: text("status").notNull(), // running | ok | error | skipped
  startedAt: now("started_at"),
  finishedAt: ts("finished_at"),
  message: text("message"),
}, (t) => [uniqueIndex("job_runs_job_slot").on(t.job, t.slot), index("job_runs_started").on(t.startedAt)]);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: id(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: now("created_at"),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(), // opportunity | briefing | test | system
  title: text("title").notNull(),
  body: text("body").notNull(),
  url: text("url"),
  sent: boolean("sent").notNull().default(false),
  reason: text("reason"),
  createdAt: now("created_at"),
});

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});
