/**
 * Job worker API route — processes pg-boss extraction jobs.
 *
 * Designed as a fallback para Netlify Scheduled Functions (requires Pro plan).
 * On free Netlify tiers, use cron-job.org ou similar pra chamar este endpoint a cada minuto:
 *   POST https://seu-dominio.netlify.app/api/internal/job-worker
 *   Header: x-worker-secret: <WORKER_SECRET>
 *
 * This route can also run on Pro plan as a backup if scheduled functions fail.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { getBoss } from "@/lib/jobs/boss";
import { JOB_HANDLERS, JOB_QUEUES } from "@/lib/jobs/handlers";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

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

export async function POST(req: Request) {
  // Autenticar via secret token — impede qualquer um de triggar o worker
  const secret = (await headers()).get("x-worker-secret");
  if (!isValidWorkerSecret(secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const boss = await getBoss();

    let totalProcessed = 0;

    for (const queue of JOB_QUEUES) {
      const jobs = await boss.fetch(queue, { batchSize: BATCH_SIZE });
      if (!jobs || jobs.length === 0) continue;

      for (const job of jobs) {
        try {
          await JOB_HANDLERS[queue](job.data);
          await boss.complete(queue, job.id);
          totalProcessed++;
        } catch (err) {
          console.error(`[job-worker API] job ${job.id} (${queue}) failed:`, err);
          await boss.fail(queue, job.id, {
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return NextResponse.json(
      {
        ok: true,
        jobsProcessed: totalProcessed,
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[job-worker API] fatal error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
