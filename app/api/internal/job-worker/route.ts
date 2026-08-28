/**
 * Job worker API route — processes pg-boss extraction jobs.
 *
 * Redundancy for the primary path (netlify/functions/job-worker.ts, a Scheduled Function
 * running every minute). Point an external cron at it — cron-job.org or similar — every
 * 5 minutes, so a broken schedule degrades the pipeline instead of stopping it:
 *   POST https://crm.techhive.com.br/api/internal/job-worker
 *   Header: x-worker-secret: <WORKER_SECRET>
 *
 * Excluded from the auth middleware (see middleware.ts) — the secret is the only gate.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { expireStalledExtractions } from "@/lib/extractions/watchdog";
import { getBoss } from "@/lib/jobs/boss";
import { drainQueues } from "@/lib/jobs/dispatch";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

/** Same ~10s function ceiling as the scheduled worker. */
const BUDGET_MS = 8_000;
const BATCH_SIZE = 5;

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Constant-time comparison — hashing first also normalizes length, so `!==` on
 *  raw strings (which short-circuits and leaks timing on length/prefix) is avoided. */
function isValidWorkerSecret(provided: string | null): boolean {
  const expected = process.env.WORKER_SECRET;
  if (!expected || !provided) return false;
  return timingSafeEqual(sha256(provided), sha256(expected));
}

export async function POST() {
  const secret = (await headers()).get("x-worker-secret");
  if (!isValidWorkerSecret(secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const boss = await getBoss({ role: "worker" });

    const result = await drainQueues(boss, {
      budgetMs: BUDGET_MS,
      batchSize: BATCH_SIZE,
      label: "[job-worker API]",
    });

    const { expired } = await expireStalledExtractions();

    return NextResponse.json(
      { ok: true, ...result, expired, timestamp: new Date().toISOString() },
      { status: 200 },
    );
  } catch (err) {
    console.error("[job-worker API] fatal error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
