/**
 * pg-boss job handler for Google Maps extractions.
 * Each job processes ONE page of results (~20 places).
 * This keeps job duration well under Netlify's 26s Function timeout.
 *
 * Job flow:
 *  1. "extraction:start" job → validates, calls searchPlaces page 1, saves results,
 *                              enqueues "extraction:page" job if nextPageToken exists
 *  2. "extraction:page" jobs → process subsequent pages
 *  3. When no nextPageToken, marks extraction as completed
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { extractionResults, extractions } from "@/db/schema";
import { searchPlaces } from "./client";
import { findInstagramHandle } from "@/lib/instagram-finder/finder";

if (!process.env.GOOGLE_PLACES_API_KEY) {
  // Warn at import time — will throw when job actually runs
  console.warn("GOOGLE_PLACES_API_KEY is not set");
}

export interface ExtractionStartJobData {
  extractionId: string;
  query: string;
  city: string;
  state: string;
  radiusMeters: number | undefined;
  maxResults: number;
  processed: number | undefined;
  pageToken: string | undefined;
}

/**
 * Process one page of an extraction job.
 * Called by the Netlify Scheduled Function worker (via boss.fetch) or the dev worker.
 * Throws on error — the caller is responsible for calling boss.fail().
 */
export async function processExtractionPage(data: ExtractionStartJobData): Promise<void> {
  const { extractionId } = data;

  try {
    await _processExtractionPageInner(data);
  } catch (err) {
    console.error(`[extraction] job failed for extractionId=${extractionId}:`, err);

    // Best-effort: update extraction to "failed" so the user sees the error in the UI
    try {
      await db
        .update(extractions)
        .set({
          status: "failed",
          errorMessage: err instanceof Error ? err.message : String(err),
          finishedAt: new Date(),
        })
        .where(eq(extractions.id, extractionId));
    } catch (dbErr) {
      console.error("[extraction] failed to persist error status:", dbErr);
    }

    // Re-throw so the caller (job-worker) can call boss.fail()
    throw err;
  }
}

async function _processExtractionPageInner(data: ExtractionStartJobData): Promise<void> {
  const { extractionId, query, city, state, radiusMeters, maxResults, pageToken } = data;
  const processed = data.processed ?? 0;

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_PLACES_API_KEY is not set");

  // Mark as running
  await db
    .update(extractions)
    .set({ status: "running", startedAt: processed === 0 ? new Date() : undefined })
    .where(and(eq(extractions.id, extractionId), eq(extractions.status, processed === 0 ? "queued" : "running")));

  const extraction = await db.query.extractions.findFirst({
    where: eq(extractions.id, extractionId),
    columns: { id: true, projectId: true, status: true, costUsd: true },
  });
  if (!extraction || extraction.status === "cancelled") return;

  // Fetch one page
  const { places, nextPageToken, costUsd } = await searchPlaces({
    query,
    city,
    state,
    radiusMeters,
    pageToken,
    apiKey,
  });

  // Check for duplicates by place_id — only query the IDs we're about to insert
  const currentPlaceIds = places.map((p) => p.id);
  const existingPlaceIds = new Set(
    (
      await db.query.extractionResults.findMany({
        where: and(
          eq(extractionResults.projectId, extraction.projectId),
          inArray(extractionResults.placeId, currentPlaceIds),
        ),
        columns: { placeId: true },
      })
    ).map((r) => r.placeId),
  );

  const newPlaces = places.filter((p) => !existingPlaceIds.has(p.id));

  // Enrich Instagram handles for new places (batched to limit concurrent connections)
  const BATCH_SIZE = 5;
  const INSTAGRAM_TIMEOUT_MS = 3000;
  const enriched: PromiseSettledResult<{ place: typeof newPlaces[number]; instagramHandle: string | undefined; instagramSource: string | undefined }>[] = [];
  for (let i = 0; i < newPlaces.length; i += BATCH_SIZE) {
    const batch = newPlaces.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (place) => {
        const { handle, source } = await Promise.race([
          findInstagramHandle(place),
          new Promise<Awaited<ReturnType<typeof findInstagramHandle>>>((resolve) =>
            setTimeout(() => resolve({ handle: undefined, source: undefined }), INSTAGRAM_TIMEOUT_MS)
          ),
        ]);
        return { place, instagramHandle: handle, instagramSource: source };
      }),
    );
    enriched.push(...batchResults);
  }

  // Persist results
  if (enriched.length > 0) {
    await db.insert(extractionResults).values(
      enriched.map((result) => {
        const item = result.status === "fulfilled" ? result.value : { place: newPlaces[enriched.indexOf(result)]!, instagramHandle: undefined, instagramSource: undefined };
        return {
          extractionId,
          projectId: extraction.projectId,
          placeId: item.place.id,
          name: item.place.name,
          address: item.place.address,
          city: item.place.city,
          state: item.place.state,
          phone: item.place.phone,
          website: item.place.website,
          instagramHandle: item.instagramHandle ?? null,
          instagramSource: item.instagramSource ?? null,
          category: item.place.category,
          rating: item.place.rating,
          reviewsCount: item.place.reviewsCount,
          lat: item.place.lat,
          lng: item.place.lng,
          photoUrl: item.place.photoUrl,
          raw: item.place.raw,
          status: "pending" as const,
        };
      }),
    );
  }

  const newProcessed = processed + places.length;
  const newCost = (extraction.costUsd ?? 0) + costUsd;

  // Check if we should continue
  const shouldContinue = nextPageToken && newProcessed < maxResults;

  if (shouldContinue) {
    // Update progress
    await db
      .update(extractions)
      .set({
        processed: newProcessed,
        totalFound: newProcessed,
        costUsd: newCost,
      })
      .where(eq(extractions.id, extractionId));

    // Enqueue next page job via pg-boss
    const { getBoss } = await import("@/lib/jobs/boss");
    const boss = await getBoss();
    const nextJobData: ExtractionStartJobData = {
      extractionId,
      query,
      city,
      state,
      radiusMeters,
      maxResults,
      processed: newProcessed,
      pageToken: nextPageToken,
    };
    await boss.send("extraction:page", nextJobData);
  } else {
    // Mark as completed
    await db
      .update(extractions)
      .set({
        status: "completed",
        processed: newProcessed,
        totalFound: newProcessed,
        costUsd: newCost,
        finishedAt: new Date(),
      })
      .where(eq(extractions.id, extractionId));
  }
}
