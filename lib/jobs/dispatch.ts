/**
 * Shared queue-draining loop for every worker entry point.
 *
 * Why this exists: the three workers (Netlify Scheduled Function, the
 * /api/internal/job-worker fallback route, and the local dev-worker) used to each
 * reimplement `for (queue) { fetch; for (job) { handle; complete/fail } }` with no
 * notion of how long they had been running. Netlify Functions are killed at ~10s on
 * the free tier / ~26s on Pro. A batch that overruns dies *after* jobs were pulled
 * from the queue (state = active) but *before* complete() or fail() — so the job hangs
 * until pg-boss's expireInSeconds (60-120s, see lib/jobs/boss.ts) reclaims it. That is
 * the same "stuck forever" failure mode the scheduled function itself had, one layer down.
 *
 * The fix is a time budget checked *before* each fetch: never start work we cannot
 * plausibly finish. A job already in flight is always allowed to complete — abandoning
 * it mid-run is exactly what we are trying to avoid.
 */
import type PgBoss from "pg-boss";
import { JOB_HANDLERS, JOB_QUEUES } from "./handlers";

export interface DrainOptions {
  /** Stop pulling new work once this much wall-clock time has elapsed. */
  budgetMs: number;
  /** Max jobs pulled per queue per fetch. */
  batchSize?: number;
  /** Prefix for log lines, e.g. "[job-worker]". */
  label?: string;
}

export interface DrainResult {
  processed: number;
  failed: number;
  /** True when the budget ran out before every queue was visited. */
  budgetExhausted: boolean;
}

const DEFAULT_BATCH_SIZE = 5;

export async function drainQueues(boss: PgBoss, options: DrainOptions): Promise<DrainResult> {
  const { budgetMs, batchSize = DEFAULT_BATCH_SIZE, label = "[dispatch]" } = options;
  const startedAt = Date.now();

  let processed = 0;
  let failed = 0;
  let budgetExhausted = false;

  for (const queue of JOB_QUEUES) {
    if (Date.now() - startedAt > budgetMs) {
      budgetExhausted = true;
      break;
    }

    let jobs: Awaited<ReturnType<typeof boss.fetch>>;
    try {
      jobs = await boss.fetch(queue, { batchSize });
    } catch (err) {
      // A failing fetch on one queue must not abort the others — a bad job payload in
      // "enrich:deep" should never stop extractions from progressing.
      console.error(`${label} fetch failed for "${queue}":`, err);
      continue;
    }

    if (!jobs || jobs.length === 0) continue;

    // Sequential, not parallel: the budget only means something if work is serialized.
    for (const job of jobs) {
      try {
        await JOB_HANDLERS[queue](job.data);
        await boss.complete(queue, job.id);
        processed++;
      } catch (err) {
        console.error(`${label} job ${job.id} (${queue}) failed:`, err);
        failed++;
        try {
          await boss.fail(queue, job.id, {
            message: err instanceof Error ? err.message : String(err),
          });
        } catch (failErr) {
          // If even fail() cannot be recorded the job will be reclaimed on expiry —
          // log it so the retry is not mistaken for a fresh dispatch.
          console.error(`${label} could not mark job ${job.id} as failed:`, failErr);
        }
      }
    }
  }

  return { processed, failed, budgetExhausted };
}
