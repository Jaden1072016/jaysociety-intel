CREATE TABLE "api_usage" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"day" text NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "briefings" (
	"id" text PRIMARY KEY NOT NULL,
	"date" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	CONSTRAINT "briefings_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "cache_entries" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_daily" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"date" text NOT NULL,
	"metrics" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"platform" text NOT NULL,
	"handle" text NOT NULL,
	"url" text,
	"external_id" text,
	"display_name" text,
	"follower_count" integer,
	"verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"resolve_error" text,
	"last_fetched_at" timestamp with time zone,
	"uploads_playlist" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creators" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_self" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 2 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"disambiguation" text,
	"notes" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creators_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"variable" text NOT NULL,
	"arm_a" text NOT NULL,
	"arm_b" text NOT NULL,
	"hypothesis" text,
	"status" text DEFAULT 'running' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'Researching' NOT NULL,
	"format" text,
	"platforms" text[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"script" text,
	"hook" text,
	"source_links" text[] DEFAULT '{}' NOT NULL,
	"opportunity_id" text,
	"experiment_id" text,
	"experiment_arm" text,
	"published_url" text,
	"published_at" timestamp with time zone,
	"results" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"slot" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"message" text
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"ip" text NOT NULL,
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"url" text,
	"sent" boolean DEFAULT false NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_connections" (
	"provider" text PRIMARY KEY NOT NULL,
	"account_id" text,
	"account_name" text,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"scope" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"batch_id" text NOT NULL,
	"topic" text NOT NULL,
	"topic_key" text NOT NULL,
	"title" text NOT NULL,
	"hook" text NOT NULL,
	"concept" text NOT NULL,
	"livestream" text,
	"clips" text[] DEFAULT '{}' NOT NULL,
	"platforms" text[] DEFAULT '{}' NOT NULL,
	"production" text,
	"why_fits" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"ai_notes" text,
	"generator" text NOT NULL,
	"scores" jsonb NOT NULL,
	"total_score" double precision NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"notified_at" timestamp with time zone,
	"idea_id" text
);
--> statement-breakpoint
CREATE TABLE "own_video_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"video_id" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"views" integer,
	"avg_view_duration_sec" double precision,
	"avg_view_pct" double precision,
	"subscribers_gained" integer,
	"subscribers_lost" integer,
	"likes" integer,
	"comments" integer,
	"shares" integer
);
--> statement-breakpoint
CREATE TABLE "provider_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_status" (
	"provider" text PRIMARY KEY NOT NULL,
	"support_level" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trends" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"approx_traffic" text,
	"traffic_num" integer,
	"published_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_count" integer DEFAULT 1 NOT NULL,
	"news" jsonb,
	"relevance" double precision DEFAULT 0 NOT NULL,
	"matched_topics" text[] DEFAULT '{}' NOT NULL,
	"cluster_key" text,
	"support_level" text DEFAULT 'full' NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"video_id" text NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"age_hours" double precision NOT NULL,
	"views" integer,
	"likes" integer,
	"comments" integer
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"published_at" timestamp with time zone NOT NULL,
	"duration_sec" integer,
	"format" text DEFAULT 'unknown' NOT NULL,
	"thumbnail" text,
	"source" text DEFAULT 'api' NOT NULL,
	"is_own" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_snapshot_at" timestamp with time zone,
	"latest_views" integer,
	"latest_likes" integer,
	"latest_comments" integer,
	"perf_ratio" double precision,
	"perf_confidence" text,
	"perf_basis" text,
	"formats" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creator_accounts" ADD CONSTRAINT "creator_accounts_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "own_video_metrics" ADD CONSTRAINT "own_video_metrics_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_snapshots" ADD CONSTRAINT "video_snapshots_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_account_id_creator_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."creator_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_usage_provider_day" ON "api_usage" USING btree ("provider","day");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_daily_platform_date" ON "channel_daily" USING btree ("platform","date");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_accounts_platform_handle" ON "creator_accounts" USING btree ("platform","handle");--> statement-breakpoint
CREATE INDEX "ideas_status" ON "ideas" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "job_runs_job_slot" ON "job_runs" USING btree ("job","slot");--> statement-breakpoint
CREATE INDEX "job_runs_started" ON "job_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_idx" ON "login_attempts" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "opps_created" ON "opportunities" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "opps_topic" ON "opportunities" USING btree ("topic_key");--> statement-breakpoint
CREATE INDEX "own_metrics_video" ON "own_video_metrics" USING btree ("video_id","fetched_at");--> statement-breakpoint
CREATE INDEX "provider_logs_created" ON "provider_logs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trends_source_key" ON "trends" USING btree ("source","key");--> statement-breakpoint
CREATE INDEX "trends_last_seen" ON "trends" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "video_snapshots_video" ON "video_snapshots" USING btree ("video_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "videos_platform_external" ON "videos" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "videos_account_published" ON "videos" USING btree ("account_id","published_at");