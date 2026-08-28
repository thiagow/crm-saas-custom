/**
 * Expires extractions that stopped making progress.
 *
 * Why: on 2026-08-26 an extraction sat in `queued` for two days. Nothing was broken
 * from the app's point of view — the row said "queued", the pg-boss job said "created",
 * and no code anywhere distinguished "queued for 10 seconds" from "queued forever".
 * A stuck pipeline that reports no error is indistinguishable from a slow one, which is
 * why that bug survived two rounds of fixes. This turns the silent stall into a visible
 * failure with a cause attached.
 *
 * Run from the worker role only (see lib/jobs/dispatch.ts callers) — it must not race
 * with itself across a request/worker pair.
 */
import { extractions } from "@/db/schema";
import { db } from "@/lib/db/client";
import { and, eq, isNull, lt, or } from "drizzle-orm";

/** A queued job should be picked up on the next worker tick (~1 min). Ten minutes means
 *  no worker is draining the queue at all. */
const QUEUED_TIMEOUT_MS = 10 * 60_000;

/** The Apify poll loop is capped at MAX_POLL_ATTEMPTS × POLL_DELAY_SECONDS (~20 min,
 *  lib/apify/job-handler.ts) plus ingest paging. 45 min is comfortably past any healthy run. */
const RUNNING_TIMEOUT_MS = 45 * 60_000;

export interface WatchdogResult {
  expired: number;
}

export async function expireStalledExtractions(): Promise<WatchdogResult> {
  const now = Date.now();
  const queuedCutoff = new Date(now - QUEUED_TIMEOUT_MS);
  const runningCutoff = new Date(now - RUNNING_TIMEOUT_MS);

  const stalled = await db
    .update(extractions)
    .set({
      status: "failed",
      errorMessage:
        "Extração expirada pelo watchdog — nenhum worker processou o job dentro do tempo esperado. " +
        "Verifique se a Scheduled Function 'job-worker' está agendada na Netlify.",
      finishedAt: new Date(),
    })
    .where(
      or(
        and(eq(extractions.status, "queued"), lt(extractions.createdAt, queuedCutoff)),
        and(
          eq(extractions.status, "running"),
          // startedAt is set the moment the Apify run is created; a running row without
          // one never got past handleExtractionStart, so fall back to createdAt.
          or(
            lt(extractions.startedAt, runningCutoff),
            and(isNull(extractions.startedAt), lt(extractions.createdAt, runningCutoff)),
          ),
        ),
      ),
    )
    .returning({ id: extractions.id, status: extractions.status });

  if (stalled.length > 0) {
    console.error(
      `[watchdog] expired ${stalled.length} stalled extraction(s):`,
      stalled.map((e) => e.id).join(", "),
    );
    await reportToSentry(stalled.map((e) => e.id));
  }

  return { expired: stalled.length };
}

/** Best-effort: Sentry is only initialised inside the Next runtime (sentry.server.config.ts).
 *  From the standalone Netlify function this is a no-op, and must never throw there. */
async function reportToSentry(extractionIds: string[]): Promise<void> {
  try {
    const Sentry = await import("@sentry/nextjs");
    for (const id of extractionIds) {
      Sentry.captureMessage("Extraction stalled and was expired by the watchdog", {
        level: "error",
        tags: { extractionId: id },
      });
    }
  } catch {
    // Sentry unavailable in this runtime — the console.error above is the record.
  }
}
