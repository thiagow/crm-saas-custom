/**
 * Local development worker for pg-boss jobs.
 * In production this is the Netlify Scheduled Function (netlify/functions/job-worker.ts).
 * Locally there is no Netlify cron, so this module polls the queues on a timer.
 *
 * Shares drainQueues() with both production workers so local behaviour — including the
 * time budget and the complete/fail bookkeeping — is the same code path that ships.
 *
 * The interval handle is stored on globalThis so it survives Next.js HMR —
 * when the module is reloaded, the old interval is cleared before creating a new one.
 *
 * Started from instrumentation.ts only when NODE_ENV === "development".
 */
import { expireStalledExtractions } from "@/lib/extractions/watchdog";
import { getBoss } from "./boss";
import { drainQueues } from "./dispatch";

const POLL_INTERVAL_MS = 2_000;
/** Shorter than production's: the point locally is to never overlap two polls. */
const BUDGET_MS = 1_500;
const BATCH_SIZE = 5;
/** The watchdog only needs to run occasionally; at a 2s poll that is every 5 min. */
const WATCHDOG_EVERY_N_POLLS = 150;

const g = globalThis as unknown as {
  __devWorkerInterval?: ReturnType<typeof setInterval> | undefined;
};

export async function startDevWorker() {
  // Clear any existing worker left over from a previous HMR cycle
  if (g.__devWorkerInterval) {
    clearInterval(g.__devWorkerInterval);
    g.__devWorkerInterval = undefined;
  }

  // Ensure boss is started (creates pgboss.* tables on first run)
  await getBoss({ role: "worker" });

  let polls = 0;
  let running = false;

  async function poll() {
    // A slow job must not stack up overlapping polls on a 2s timer.
    if (running) return;
    running = true;
    try {
      const boss = await getBoss({ role: "worker" });
      const result = await drainQueues(boss, {
        budgetMs: BUDGET_MS,
        batchSize: BATCH_SIZE,
        label: "[dev-worker]",
      });

      if (result.processed > 0 || result.failed > 0) {
        console.log(
          `[dev-worker] processed ${result.processed}, failed ${result.failed}${result.budgetExhausted ? " (budget exhausted)" : ""}`,
        );
      }

      if (polls++ % WATCHDOG_EVERY_N_POLLS === 0) {
        await expireStalledExtractions();
      }
    } catch (err) {
      console.error("[dev-worker] poll failed:", err);
    } finally {
      running = false;
    }
  }

  g.__devWorkerInterval = setInterval(poll, POLL_INTERVAL_MS);
  console.log(`[dev-worker] polling every ${POLL_INTERVAL_MS / 1000}s for extraction jobs`);
}
