import { extractionResults, extractions } from "@/db/schema";
import { db } from "@/lib/db/client";
import type { SiteEnrichJobData } from "@/lib/enrichment/site-job-handler";
import { getBoss } from "@/lib/jobs/boss";
/**
 * pg-boss handlers for the Apify-backed extraction pipeline.
 *
 * Apify runs are async and can take minutes — far longer than Netlify's ~26s
 * Function budget — so the flow is split into short jobs instead of one blocking call:
 *
 *   extraction:apify-start → startRun() → save runId/datasetId → enqueue extraction:poll
 *   extraction:poll   → getRun()
 *                        ├─ still running → re-enqueue poll (singletonKey = extractionId,
 *                        │                  so at most one poll is ever in flight per extraction)
 *                        ├─ succeeded     → save real cost → enqueue extraction:ingest
 *                        └─ failed/aborted/timed-out → fall back to the Google Places pipeline
 *                                                       (lib/google-places/job-handler.ts)
 *   extraction:ingest → listDatasetItems(offset, 50) → map → insert (onConflictDoNothing)
 *                        ├─ more pages → re-enqueue ingest at offset+50
 *                        └─ done       → mark extraction completed
 *
 * Every handler follows the same shape as the legacy processExtractionPage: an inner
 * function does the work, an outer try/catch persists the error to `extractions` and
 * re-throws so the caller's boss.fail() runs pg-boss's own retry/backoff.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { ACTORS, buildDiscoveryInput } from "./actors";
import {
  ApifyError,
  abortRun,
  getRun,
  isTerminalRunStatus,
  listDatasetItems,
  startRun,
} from "./client";
import { type ApifyGoogleMapsItem, mapDiscoveryItem } from "./mappers";

const MAX_POLL_ATTEMPTS = 60; // ~20 min at the poll cadence below
const POLL_DELAY_SECONDS = 15;
const INGEST_PAGE_SIZE = 50;
/** Hard ceiling on Apify spend for a single run, independent of the pre-run estimate. */
const MAX_RUN_COST_USD = Number.parseFloat(process.env.APIFY_MAX_RUN_COST_USD ?? "2.00");

/**
 * Mid-run duplicate cut-off.
 *
 * Apify bills per place as it crawls, so by the time a run finishes the money is already
 * spent — checking for duplicates at ingest would only produce a post-mortem. Datasets of
 * a RUNNING run are readable, so each poll samples what has landed so far and aborts the
 * run when it is mostly places the project already has. The sample floor keeps a run of
 * three early duplicates from killing an otherwise good search.
 */
const DUPLICATE_SAMPLE_SIZE = 30;
const DUPLICATE_SAMPLE_MIN = 20;
const DUPLICATE_ABORT_RATIO = 0.7;

export interface StartJobData {
  extractionId: string;
}
export interface PollJobData {
  extractionId: string;
}
export interface IngestJobData {
  extractionId: string;
  offset: number;
}

/** How many of these placeIds the project already stores. */
async function countKnownPlaceIds(projectId: string, placeIds: string[]): Promise<number> {
  if (placeIds.length === 0) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(extractionResults)
    .where(
      and(eq(extractionResults.projectId, projectId), inArray(extractionResults.placeId, placeIds)),
    );
  return row?.count ?? 0;
}

/**
 * Aborts a still-running Apify run whose results are mostly places already in the base.
 * Returns true when the run was cut, so the caller stops re-enqueueing the poll.
 */
async function abortIfMostlyDuplicates(extraction: {
  id: string;
  projectId: string;
  apifyRunId: string;
  apifyDatasetId: string | null;
}): Promise<boolean> {
  if (!extraction.apifyDatasetId) return false;

  const { items } = await listDatasetItems<{ placeId?: string }>({
    datasetId: extraction.apifyDatasetId,
    offset: 0,
    limit: DUPLICATE_SAMPLE_SIZE,
  });

  const placeIds = items.map((i) => i.placeId).filter((id): id is string => !!id);
  if (placeIds.length < DUPLICATE_SAMPLE_MIN) return false;

  const known = await countKnownPlaceIds(extraction.projectId, placeIds);
  const ratio = known / placeIds.length;
  if (ratio < DUPLICATE_ABORT_RATIO) return false;

  const percent = Math.round(ratio * 100);
  console.warn(
    `[apify-extraction] aborting run ${extraction.apifyRunId} — ${percent}% duplicates in sample`,
  );
  await abortRun(extraction.apifyRunId).catch((err) =>
    console.error(`[apify-extraction] abortRun failed for ${extraction.apifyRunId}:`, err),
  );

  await db
    .update(extractions)
    .set({
      status: "cancelled",
      errorMessage: `Interrompida automaticamente: ${percent}% dos resultados já estavam na base. Use um filtro diferente (sem site, 4+ estrelas, outro CEP) para alcançar empresas novas.`,
      finishedAt: new Date(),
    })
    .where(eq(extractions.id, extraction.id));

  return true;
}

async function withFailureRecorded<T>(extractionId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[apify-extraction] job failed for extractionId=${extractionId}:`, err);
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
      console.error("[apify-extraction] failed to persist error status:", dbErr);
    }
    throw err;
  }
}

export async function handleExtractionStart(data: StartJobData): Promise<void> {
  const { extractionId } = data;
  await withFailureRecorded(extractionId, async () => {
    const extraction = await db.query.extractions.findFirst({
      where: eq(extractions.id, extractionId),
    });
    if (!extraction) throw new Error(`Extraction ${extractionId} not found`);
    if (extraction.status === "cancelled") return;

    const input = buildDiscoveryInput({
      query: extraction.query,
      city: extraction.city,
      state: extraction.state,
      maxResults: extraction.maxResults,
      enrichContacts: extraction.enrichContacts,
      filters: extraction.filters,
    });

    const run = await startRun({
      actorId: ACTORS.googleMaps,
      input,
      maxItems: extraction.maxResults,
      timeoutSecs: 900,
    });

    await db
      .update(extractions)
      .set({
        status: "running",
        startedAt: new Date(),
        apifyRunId: run.runId,
        apifyDatasetId: run.datasetId,
      })
      .where(eq(extractions.id, extractionId));

    const boss = await getBoss();
    await boss.send("extraction:poll", { extractionId } satisfies PollJobData, {
      singletonKey: extractionId,
      startAfter: POLL_DELAY_SECONDS,
    });
  });
}

export async function handleExtractionPoll(data: PollJobData): Promise<void> {
  const { extractionId } = data;
  await withFailureRecorded(extractionId, async () => {
    const extraction = await db.query.extractions.findFirst({
      where: eq(extractions.id, extractionId),
    });
    if (!extraction || extraction.status === "cancelled") return;
    if (!extraction.apifyRunId)
      throw new Error(`Extraction ${extractionId} has no apifyRunId to poll`);

    const run = await getRun(extraction.apifyRunId);
    const usageTotalUsd = run.usageTotalUsd ?? 0;

    if (usageTotalUsd > MAX_RUN_COST_USD) {
      await abortRun(extraction.apifyRunId).catch((err) =>
        console.error(`[apify-extraction] abortRun failed for ${extraction.apifyRunId}:`, err),
      );
      throw new Error(
        `Apify run excedeu o teto de custo (US$ ${usageTotalUsd.toFixed(2)} > US$ ${MAX_RUN_COST_USD.toFixed(2)}) — abortado`,
      );
    }

    if (!isTerminalRunStatus(run.status)) {
      // Cut a wasteful re-run while it is still costing money, not after.
      const aborted = await abortIfMostlyDuplicates({
        id: extraction.id,
        projectId: extraction.projectId,
        apifyRunId: extraction.apifyRunId,
        apifyDatasetId: extraction.apifyDatasetId,
      });
      if (aborted) return;

      const pollAttempts = extraction.pollAttempts + 1;
      if (pollAttempts > MAX_POLL_ATTEMPTS) {
        await abortRun(extraction.apifyRunId).catch((err) =>
          console.error(`[apify-extraction] abortRun failed for ${extraction.apifyRunId}:`, err),
        );
        throw new Error(
          `Apify run não terminou após ${MAX_POLL_ATTEMPTS} tentativas de poll — timeout`,
        );
      }
      await db
        .update(extractions)
        .set({ pollAttempts, estimatedCostUsd: usageTotalUsd })
        .where(eq(extractions.id, extractionId));

      const boss = await getBoss();
      await boss.send("extraction:poll", { extractionId } satisfies PollJobData, {
        singletonKey: extractionId,
        startAfter: POLL_DELAY_SECONDS,
      });
      return;
    }

    if (run.status === "SUCCEEDED") {
      await db
        .update(extractions)
        .set({ costUsd: usageTotalUsd, estimatedCostUsd: usageTotalUsd })
        .where(eq(extractions.id, extractionId));

      const boss = await getBoss();
      await boss.send("extraction:ingest", { extractionId, offset: 0 } satisfies IngestJobData);
      return;
    }

    // FAILED / ABORTED / TIMED-OUT — fall back to the Google Places pipeline rather
    // than failing the whole extraction outright. Never silent: errorMessage says why.
    console.warn(
      `[apify-extraction] run ${extraction.apifyRunId} ended in ${run.status} — falling back to Google Places`,
    );
    await db
      .update(extractions)
      .set({
        provider: "google_places",
        errorMessage: `Apify falhou (${run.status}${run.statusMessage ? `: ${run.statusMessage}` : ""}) — usando Google Places`,
      })
      .where(eq(extractions.id, extractionId));

    const { getBoss: getBossFallback } = await import("@/lib/jobs/boss");
    const boss = await getBossFallback();
    await boss.send("extraction:page", {
      extractionId,
      query: extraction.query,
      city: extraction.city,
      state: extraction.state,
      radiusMeters: extraction.radiusMeters ?? undefined,
      maxResults: extraction.maxResults,
      processed: 0,
      pageToken: undefined,
    });
  });
}

export async function handleExtractionIngest(data: IngestJobData): Promise<void> {
  const { extractionId, offset } = data;
  await withFailureRecorded(extractionId, async () => {
    const extraction = await db.query.extractions.findFirst({
      where: eq(extractions.id, extractionId),
      columns: { id: true, projectId: true, status: true, apifyDatasetId: true, processed: true },
    });
    if (!extraction || extraction.status === "cancelled") return;
    if (!extraction.apifyDatasetId)
      throw new Error(`Extraction ${extractionId} has no apifyDatasetId to ingest`);

    const { items, total } = await listDatasetItems<ApifyGoogleMapsItem>({
      datasetId: extraction.apifyDatasetId,
      offset,
      limit: INGEST_PAGE_SIZE,
    });

    let inserted = 0;
    let candidates = 0;
    if (items.length > 0) {
      const rows = items
        .filter((item) => !!item.placeId)
        .map((item) => {
          const mapped = mapDiscoveryItem(item);
          return {
            extractionId,
            projectId: extraction.projectId,
            ...mapped,
            status: "pending" as const,
          };
        });
      candidates = rows.length;

      if (rows.length > 0) {
        const insertedRows = await db
          .insert(extractionResults)
          .values(rows)
          .onConflictDoNothing({ target: [extractionResults.projectId, extractionResults.placeId] })
          .returning({ id: extractionResults.id });
        inserted = insertedRows.length;
      }
    }

    // onConflictDoNothing silently drops places the project already has. Counting the gap
    // is what turns "the extraction found nothing" into "38 of these were already yours".
    const duplicates = candidates - inserted;
    const newProcessed = extraction.processed + inserted;
    const nextOffset = offset + items.length;
    const hasMore = nextOffset < total;

    await db
      .update(extractions)
      .set({
        processed: newProcessed,
        totalFound: total,
        duplicates: sql`${extractions.duplicates} + ${duplicates}`,
        ...(hasMore ? {} : { status: "completed" as const, finishedAt: new Date() }),
      })
      .where(and(eq(extractions.id, extractionId), eq(extractions.status, "running")));

    if (hasMore) {
      const boss = await getBoss();
      await boss.send("extraction:ingest", {
        extractionId,
        offset: nextOffset,
      } satisfies IngestJobData);
      return;
    }

    // Ingest done — kick off the free site crawl that fills in Instagram and e-mail
    // (lib/enrichment/site-job-handler.ts). Deliberately not blocking the extraction's
    // "completed" status: the results are already usable without it.
    const boss = await getBoss();
    await boss.send("enrich:site", {
      extractionId,
      projectId: extraction.projectId,
    } satisfies SiteEnrichJobData);
  });
}

export { ApifyError };
