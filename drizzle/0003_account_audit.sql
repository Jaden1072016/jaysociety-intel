ALTER TABLE "creator_accounts" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "creator_accounts" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "creator_accounts" ADD COLUMN "confidence" text;--> statement-breakpoint
ALTER TABLE "creator_accounts" ADD COLUMN "tracking_decision" text;--> statement-breakpoint
ALTER TABLE "creator_accounts" ADD COLUMN "verification_method" text;--> statement-breakpoint
ALTER TABLE "creator_accounts" ADD COLUMN "evidence_url" text;--> statement-breakpoint
ALTER TABLE "creator_accounts" ADD COLUMN "caution" text;--> statement-breakpoint
ALTER TABLE "creator_accounts" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "creator_accounts" ADD COLUMN "approved_by" text;--> statement-breakpoint
-- Backfill: accounts already confirmed in chat on 2026-11-23 (owner supplied the list).
UPDATE "creator_accounts" SET "role" = 'Main', "approved_by" = 'owner (chat list, 2026-11-23)', "checked_at" = now() WHERE "verified" = true AND "approved_by" IS NULL;
