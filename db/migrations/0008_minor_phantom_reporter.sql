CREATE TYPE "public"."email_validation_status" AS ENUM('none', 'queued', 'deliverable', 'undeliverable', 'risky', 'unknown', 'failed');--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "instagram_bio" text;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "instagram_deep_run_id" text;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "instagram_deep_status" "deep_search_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "instagram_deep_error" text;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "email_validation_status" "email_validation_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "email_validated_at" timestamp;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "email_validation_reason" text;