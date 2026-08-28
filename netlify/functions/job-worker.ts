/**
 * Netlify Scheduled Function — runs every minute.
 * Drains the pg-boss job queues and expires stalled extractions.
 *
 * ⚠️ This MUST stay a v2 function (default export). It was previously written as a v1
 * function (`export { handler }`) *with* a v2 `export const config` — zip-it-and-ship-it
 * classifies by export shape, so it deployed as an ordinary v1 function and silently
 * ignored the schedule. The deploy API reported `function_schedules: []` and every
 * extraction sat in "queued" forever. netlify.toml declares the same schedule as a
 * belt-and-braces guard; if you change this file, verify `function_schedules` is not
 * empty on the resulting deploy.
 *
 * Uses boss.fetch() (via drainQueues) instead of boss.work() — the correct pattern for
 * serverless. boss.work() registers long-running workers and requires boss.stop() to
 * clean up; but boss.stop() corrupts the singleton so subsequent invocations get a
 * stopped boss and never process jobs. fetch() is stateless and sidesteps this entirely.
 */
import type { Config } from "@netlify/functions";
import { expireStalledExtractions } from "../../lib/extractions/watchdog";
import { getBoss } from "../../lib/jobs/boss";
import { drainQueues } from "../../lib/jobs/dispatch";

/** Netlify Functions time out at ~10s (free) / ~26s (Pro). Leave headroom for the
 *  watchdog query and the response. */
const BUDGET_MS = 8_000;
const BATCH_SIZE = 5;

export default async function jobWorker(): Promise<Response> {
  const boss = await getBoss({ role: "worker" });

  const result = await drainQueues(boss, {
    budgetMs: BUDGET_MS,
    batchSize: BATCH_SIZE,
    label: "[job-worker]",
  });

  // Runs after the drain so a queue that is genuinely moving is never expired.
  const { expired } = await expireStalledExtractions();

  return Response.json({ ok: true, ...result, expired });
}

export const config: Config = {
  schedule: "* * * * *",
};
