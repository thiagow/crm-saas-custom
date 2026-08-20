/**
 * pg-boss singleton for job queue.
 * pg-boss stores job state in Postgres tables (prefixed with pgboss.*).
 * Tables are auto-created on first start().
 *
 * The singleton is stored on `globalThis` so it survives Next.js HMR in dev mode.
 * Module-level variables are reset on hot reload, which would orphan the pg-boss
 * instance (connection still open, workers still polling) and create a new one
 * without any registered workers.
 */
import PgBoss from "pg-boss";

const g = globalThis as unknown as { __pgBossPromise?: Promise<PgBoss> };

export async function getBoss(): Promise<PgBoss> {
  if (g.__pgBossPromise) return g.__pgBossPromise;

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for pg-boss");
  }

  const connectionString = process.env.DATABASE_URL;
  const useSSL = process.env.DATABASE_SSL === "require";

  g.__pgBossPromise = (async () => {
    const boss = new PgBoss({
      connectionString,
      ssl: useSSL,
      // Retention: keep completed jobs for 3 days for observability
      deleteAfterDays: 3,
      archiveCompletedAfterSeconds: 60 * 60 * 24, // 24h
      // Monitoring interval
      monitorStateIntervalSeconds: 30,
    });

    await boss.start();

    // pg-boss v10 requires explicit queue creation before send() — without this,
    // send() does an INNER JOIN against pgboss.queue, finds nothing, and returns null silently.
    //
    // Retry policy notes:
    // - extraction:start/page are the legacy Google Places jobs (lib/google-places/job-handler.ts).
    //   createExtraction() no longer enqueues extraction:start directly — it now only gets used
    //   as the automatic fallback when an Apify run fails (see lib/apify/job-handler.ts poll handler).
    // - extraction:apify-start/poll/ingest drive the primary Apify async-run pipeline
    //   (lib/apify/job-handler.ts). poll gets more retries + it's a wait-loop, not real work —
    //   a missed poll should never orphan a run.
    await Promise.all([
      boss.createQueue("extraction:start", {
        name: "extraction:start",
        retryLimit: 3,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 60,
      }),
      boss.createQueue("extraction:page", {
        name: "extraction:page",
        retryLimit: 3,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 60,
      }),
      boss.createQueue("extraction:apify-start", {
        name: "extraction:apify-start",
        retryLimit: 3,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 60,
      }),
      boss.createQueue("extraction:poll", {
        name: "extraction:poll",
        retryLimit: 5,
        retryDelay: 15,
        retryBackoff: true,
        expireInSeconds: 60,
      }),
      boss.createQueue("extraction:ingest", {
        name: "extraction:ingest",
        retryLimit: 3,
        retryDelay: 20,
        retryBackoff: true,
        expireInSeconds: 60,
      }),
      // "Pesquisa profunda" (CNPJ/QSA owner lookup) — lib/enrichment/job-handler.ts.
      boss.createQueue("enrich:deep", {
        name: "enrich:deep",
        retryLimit: 2,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 120,
      }),
    ]);

    console.log("[pg-boss] started successfully");
    return boss;
  })();

  return g.__pgBossPromise;
}
