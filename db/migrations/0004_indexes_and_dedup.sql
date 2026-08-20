-- Non-unique indexes first (safe, no data assumptions)
CREATE INDEX "project_members_user_idx" ON "project_members" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE INDEX "activities_lead_occurred_idx" ON "activities" USING btree ("lead_id","occurred_at" desc);--> statement-breakpoint
CREATE INDEX "leads_project_stage_idx" ON "leads" USING btree ("project_id","stage_id");--> statement-breakpoint
CREATE INDEX "leads_project_created_idx" ON "leads" USING btree ("project_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "extraction_results_triage_idx" ON "extraction_results" USING btree ("project_id","status","rating" desc);--> statement-breakpoint
CREATE INDEX "extraction_results_extraction_idx" ON "extraction_results" USING btree ("extraction_id");--> statement-breakpoint
CREATE INDEX "extractions_project_created_idx" ON "extractions" USING btree ("project_id","created_at" desc);--> statement-breakpoint

-- Dedup extraction_results by (project_id, place_id) before adding the unique index.
-- Keeps the promoted/discarded row over pending duplicates, and the physically later row on ties.
DELETE FROM "extraction_results" a USING "extraction_results" b
 WHERE a.project_id = b.project_id
   AND a.place_id = b.place_id
   AND a.id <> b.id
   AND (
     (a.status = 'pending' AND b.status <> 'pending')
     OR (a.status = b.status AND a.ctid < b.ctid)
   );--> statement-breakpoint
CREATE UNIQUE INDEX "extraction_results_project_place_uq" ON "extraction_results" USING btree ("project_id","place_id");--> statement-breakpoint

-- Dedup leads by (project_id, place_id) the same way.
DELETE FROM "leads" a USING "leads" b
 WHERE a.project_id = b.project_id
   AND a.place_id IS NOT NULL
   AND a.place_id = b.place_id
   AND a.id <> b.id
   AND a.ctid < b.ctid;--> statement-breakpoint
CREATE UNIQUE INDEX "leads_project_place_uq" ON "leads" USING btree ("project_id","place_id") WHERE "leads"."place_id" is not null;--> statement-breakpoint

-- Google Places photo URLs were built with the server-side API key embedded (lib/google-places/client.ts).
-- Any such URL leaked to the client is now invalid — null it out; the photo re-fetch layer is rebuilt in a later phase.
UPDATE "extraction_results" SET "photo_url" = NULL WHERE "photo_url" LIKE '%key=%';
