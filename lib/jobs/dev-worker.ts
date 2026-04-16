/**
 * Local development worker for pg-boss jobs.
 * In production, this is handled by the Netlify Scheduled Function (netlify/functions/job-worker.ts).
 * Locally there is no Netlify cron, so this module registers the same handlers
 * against the pg-boss singleton and lets it poll indefinitely.
 *
 * Started from instrumentation.ts only when NODE_ENV === "development".
 */
import { getBoss } from "./boss";
import { processExtractionPage } from "@/lib/google-places/job-handler";
import type { ExtractionStartJobData } from "@/lib/google-places/job-handler";
import type PgBoss from "pg-boss";

export async function startDevWorker() {
  const boss = await getBoss();

  const handler = async (jobs: PgBoss.Job<ExtractionStartJobData>[]) => {
    for (const job of jobs) {
      await processExtractionPage(job.data);
    }
  };

  await boss.work<ExtractionStartJobData>("extraction:start", handler);
  await boss.work<ExtractionStartJobData>("extraction:page", handler);

  console.log("[dev-worker] pg-boss worker started — processing extraction jobs locally");
}
