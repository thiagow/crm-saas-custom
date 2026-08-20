CREATE TYPE "public"."deep_search_status" AS ENUM('none', 'queued', 'running', 'done', 'partial', 'failed');--> statement-breakpoint
CREATE TABLE "cnpj_cache" (
	"cnpj" text PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"provider" text NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "whatsapp" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "phone_type" "phone_type" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "whatsapp_status" "whatsapp_status" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "instagram_followers" integer;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "rating" double precision;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "reviews_count" integer;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "is_on_google_maps" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "google_maps_url" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "owner_name" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "owner_email" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "cnpj" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "source_result_id" text;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "owner_name" text;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "owner_role" text;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "owner_email" text;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "cnpj" text;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "cnae_description" text;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "company_status" text;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "cnpj_confidence" double precision;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "deep_status" "deep_search_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "deep_enriched_at" timestamp;--> statement-breakpoint
ALTER TABLE "extraction_results" ADD COLUMN "deep_error" text;