/**
 * Local development worker for pg-boss jobs.
 * In production, this is handled by the Netlify Scheduled Function (netlify/functions/job-worker.ts).
 * Locally there is no Netlify cron, so this module polls the queue on a timer.
 *
 * Uses boss.fetch() (same pattern as the Netlify function) instead of boss.work()
 * for predictable, debuggable behaviour. Each poll is a discrete, logged event.
 *
 * The interval handle is stored on globalThis so it survives Next.js HMR —
 * when the module is reloaded, the old interval is cleared before creating a new one.
 *
 * Started from instrumentation.ts only when NODE_ENV === "development".
 */
import { getBoss } from "./boss";
import { processExtractionPage } from "@/lib/google-places/job-handler";
import type { ExtractionStartJobData } from "@/lib/google-places/job-handler";

const POLL_INTERVAL_MS = 2_000;
const BATCH_SIZE = 5;
const QUEUES = ["extraction:start", "extraction:page"] as const;

const g = globalThis as unknown as { __devWorkerInterval?: ReturnType<typeof setInterval> | undefined };

export async function startDevWorker() {
  // Clear any existing worker left over from a previous HMR cycle
  if (g.__devWorkerInterval) {
    clearInterval(g.__devWorkerInterval);
    g.__devWorkerInterval = undefined;
  }

  // Ensure boss is started (creates pgboss.* tables on first run)
  await getBoss();

  async function poll() {
    let boss;
    try {
      boss = await getBoss();
    } catch (err) {
      console.error("[dev-worker] failed to get boss instance:", err);
      return;
    }

    for (const queue of QUEUES) {
      try {
        const jobs = await boss.fetch<ExtractionStartJobData>(queue, { batchSize: BATCH_SIZE });
        if (!jobs || jobs.length === 0) continue;

        console.log(`[dev-worker] processing ${jobs.length} job(s) from "${queue}"`);

        for (const job of jobs) {
          try {
            await processExtractionPage(job.data);
            await boss.complete(queue, job.id);
            console.log(`[dev-worker] job ${job.id} completed`);
          } catch (err) {
            console.error(`[dev-worker] job ${job.id} failed:`, err);
            await boss.fail(queue, job.id, {
              message: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } catch (err) {
        console.error(`[dev-worker] error polling "${queue}":`, err);
      }
    }
  }

  g.__devWorkerInterval = setInterval(poll, POLL_INTERVAL_MS);
  console.log(`[dev-worker] polling every ${POLL_INTERVAL_MS / 1000}s for extraction jobs`);
}
