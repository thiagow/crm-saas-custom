CREATE TYPE "public"."gbp_status" AS ENUM('claimed', 'unclaimed', 'unknown');--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "gbp_status" "gbp_status" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "business_profile_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "social_links" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "gbp_status" "gbp_status" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "business_profile_id" text;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "social_links" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "site_enriched_at" timestamp;--> statement-breakpoint
ALTER TABLE "extractions" ADD COLUMN "duplicates" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "extractions" ADD COLUMN "filters" jsonb DEFAULT '{}'::jsonb NOT NULL;