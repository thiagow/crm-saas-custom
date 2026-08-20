CREATE TYPE "public"."extraction_provider" AS ENUM('apify', 'google_places');--> statement-breakpoint
CREATE TYPE "public"."phone_type" AS ENUM('mobile', 'landline', 'tollfree', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_status" AS ENUM('unknown', 'likely', 'verified', 'none');--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "emails" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "phone_e164" text;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "phone_type" "phone_type" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "whatsapp_number" text;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "whatsapp_status" "whatsapp_status" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "is_on_google_maps" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "google_maps_url" text;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "instagram_followers" integer;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "instagram_verified" boolean;--> statement-breakpoint
ALTER TABLE "extractions" ADD COLUMN "provider" "extraction_provider" DEFAULT 'apify' NOT NULL;--> statement-breakpoint
ALTER TABLE "extractions" ADD COLUMN "apify_run_id" text;--> statement-breakpoint
ALTER TABLE "extractions" ADD COLUMN "apify_dataset_id" text;--> statement-breakpoint
ALTER TABLE "extractions" ADD COLUMN "poll_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "extractions" ADD COLUMN "estimated_cost_usd" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "extractions" ADD COLUMN "enrich_contacts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- Rows created before this migration were all sourced from the Google Places API
-- (Apify wasn't wired in yet) — the "apify" default above only applies to new rows.
UPDATE "extractions" SET "provider" = 'google_places' WHERE "created_at" < now();