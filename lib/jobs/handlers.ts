/**
 * Queue name → handler function, shared by all three worker entry points
 * (Netlify Scheduled Function, the /api/internal/job-worker fallback route, and the
 * local dev-worker) so the routing table exists in exactly one place.
 *
 * extraction:start / extraction:page     → legacy Google Places pipeline (now only reached
 *                                           via the automatic Apify-failure fallback).
 * extraction:apify-start / poll / ingest → primary Apify pipeline (lib/apify/job-handler.ts).
 * enrich:site                            → free site crawl for Instagram/e-mail/WhatsApp
 *                                           (lib/enrichment/site-job-handler.ts).
 * enrich:deep                            → "pesquisa profunda" CNPJ/QSA owner lookup
 *                                           (lib/enrichment/job-handler.ts).
 */
import {
  handleExtractionIngest,
  handleExtractionPoll,
  handleExtractionStart,
} from "@/lib/apify/job-handler";
import { handleEnrichDeep } from "@/lib/enrichment/job-handler";
import { handleSiteEnrich } from "@/lib/enrichment/site-job-handler";
import { processExtractionPage } from "@/lib/google-places/job-handler";

export const JOB_QUEUES = [
  "extraction:start",
  "extraction:page",
  "extraction:apify-start",
  "extraction:poll",
  "extraction:ingest",
  "enrich:site",
  "enrich:deep",
] as const;

export type JobQueueName = (typeof JOB_QUEUES)[number];

// biome-ignore lint/suspicious/noExplicitAny: each handler's data type differs; the worker loop is generic over job.data.
export const JOB_HANDLERS: Record<JobQueueName, (data: any) => Promise<void>> = {
  "extraction:start": processExtractionPage,
  "extraction:page": processExtractionPage,
  "extraction:apify-start": handleExtractionStart,
  "extraction:poll": handleExtractionPoll,
  "extraction:ingest": handleExtractionIngest,
  "enrich:site": handleSiteEnrich,
  "enrich:deep": handleEnrichDeep,
};
