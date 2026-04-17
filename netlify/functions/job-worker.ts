/**
 * Netlify Scheduled Function — runs every minute.
 * Drains the pg-boss job queue for extraction jobs.
 *
 * Schedule: "* * * * *" (every 1 minute)
 * Timeout: Netlify Functions default 10s (Pro: 26s).
 * Each job processes one page of Google Places results (~20 places).
 *
 * Uses boss.fetch() instead of boss.work() — the correct pattern for serverless
 * functions. boss.work() registers long-running workers and requires boss.stop()
 * to clean up; but boss.stop() corrupts the singleton so subsequent invocations
 * get a stopped boss and never process jobs. fetch() is stateless and sidesteps
 * this entirely.
 */
import type { Config, Handler } from "@netlify/functions";
import { getBoss } from "../../lib/jobs/boss";
import { processExtractionPage } from "../../lib/google-places/job-handler";
import type { ExtractionStartJobData } from "../../lib/google-places/job-handler";

const BATCH_SIZE = 5;
const QUEUES = ["extraction:start", "extraction:page"] as const;

const handler: Handler = async () => {
  const boss = await getBoss();

  for (const queue of QUEUES) {
    const jobs = await boss.fetch<ExtractionStartJobData>(queue, { batchSize: BATCH_SIZE });
    if (!jobs || jobs.length === 0) continue;

    for (const job of jobs) {
      try {
        await processExtractionPage(job.data);
        await boss.complete(queue, job.id);
      } catch (err) {
        console.error(`[job-worker] job ${job.id} (${queue}) failed:`, err);
        await boss.fail(queue, job.id, { message: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  return { statusCode: 200, body: "OK" };
};

export { handler };

export const config: Config = {
  schedule: "* * * * *",
};
