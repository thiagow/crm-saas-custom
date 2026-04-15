/**
 * Netlify Scheduled Function — runs every minute.
 * Drains the pg-boss job queue for extraction jobs.
 *
 * Schedule: "* * * * *" (every 1 minute)
 * Timeout: Netlify Functions default 10s (Pro: 26s).
 * Each job processes one page of Google Places results (~20 places).
 */
import type { Config, Handler } from "@netlify/functions";
import { getBoss } from "../../lib/jobs/boss";
import { processExtractionPage } from "../../lib/google-places/job-handler";
import type { ExtractionStartJobData } from "../../lib/google-places/job-handler";
import type { Job } from "pg-boss";

const handler: Handler = async () => {
  const boss = await getBoss();

  // Register handlers for both job types.
  // pg-boss v10 WorkHandler receives Job<T>[] (batch), even when batchSize is 1.
  await boss.work<ExtractionStartJobData>(
    "extraction:start",
    async (jobs: Job<ExtractionStartJobData>[]) => {
      for (const job of jobs) {
        await processExtractionPage(job.data);
      }
    },
  );

  await boss.work<ExtractionStartJobData>(
    "extraction:page",
    async (jobs: Job<ExtractionStartJobData>[]) => {
      for (const job of jobs) {
        await processExtractionPage(job.data);
      }
    },
  );

  // Give the worker 20 seconds to process available jobs
  await new Promise<void>((resolve) => setTimeout(resolve, 20_000));

  await boss.stop({ graceful: false, timeout: 3000 });

  return { statusCode: 200, body: "OK" };
};

export { handler };

export const config: Config = {
  schedule: "* * * * *",
};
