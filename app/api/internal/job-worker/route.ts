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
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getBoss } from "@/lib/jobs/boss";
import { processExtractionPage } from "@/lib/google-places/job-handler";
import type { ExtractionStartJobData } from "@/lib/google-places/job-handler";

const BATCH_SIZE = 5;
const QUEUES = ["extraction:start", "extraction:page"] as const;

export async function POST(req: Request) {
  // Autenticar via secret token — impede qualquer um de triggar o worker
  const secret = (await headers()).get("x-worker-secret");
  if (secret !== process.env.WORKER_SECRET) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const boss = await getBoss();

    let totalProcessed = 0;

    for (const queue of QUEUES) {
      const jobs = await boss.fetch<ExtractionStartJobData>(queue, { batchSize: BATCH_SIZE });
      if (!jobs || jobs.length === 0) continue;

      for (const job of jobs) {
        try {
          await processExtractionPage(job.data);
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
      { status: 200 }
    );
  } catch (err) {
    console.error("[job-worker API] fatal error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
