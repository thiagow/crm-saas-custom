/**
 * pg-boss singleton for job queue.
 * pg-boss stores job state in Postgres tables (prefixed with pgboss.*).
 * Tables are auto-created on first start().
 *
 * The singleton is stored on `globalThis` so it survives Next.js HMR in dev mode.
 * Module-level variables are reset on hot reload, which would orphan the pg-boss
 * instance (connection still open, workers still polling) and create a new one
 * without any registered workers.
 *
 * ── Roles ────────────────────────────────────────────────────────────────────
 * Producers and consumers run in *different* serverless functions here (the Next
 * server handler enqueues; the scheduled function drains), so they must not boot
 * pg-boss the same way:
 *
 *   producer → only needs to send(). Supervision, cron scheduling and state
 *              monitoring are pure overhead competing for the request's own budget,
 *              and their timers keep a serverless instance busy after the response.
 *   worker   → owns maintenance (archive/delete) and owns the queue policies.
 *
 * `migrate` stays on for both on purpose: a producer that starts against a
 * not-yet-installed schema would throw at the user instead of silently degrading,
 * and pg-boss no-ops the migration once the version row is current.
 */
import PgBoss from "pg-boss";

export type BossRole = "producer" | "worker";

const g = globalThis as unknown as {
  __pgBossPromises?: Partial<Record<BossRole, Promise<PgBoss>>>;
};

/**
 * Queue definitions — the single source of truth for retry/expiry policy.
 *
 * - extraction:start/page are the legacy Google Places jobs (lib/google-places/job-handler.ts).
 *   createExtraction() no longer enqueues extraction:start directly — it now only gets used
 *   as the automatic fallback when an Apify run fails (see lib/apify/job-handler.ts poll handler).
 * - extraction:apify-start/poll/ingest drive the primary Apify async-run pipeline
 *   (lib/apify/job-handler.ts). poll gets more retries + it's a wait-loop, not real work —
 *   a missed poll should never orphan a run.
 * - enrich:deep is the "pesquisa profunda" (CNPJ/QSA owner lookup) — lib/enrichment/job-handler.ts.
 */
const QUEUE_DEFINITIONS = [
  { name: "extraction:start", retryLimit: 3, retryDelay: 30, expireInSeconds: 60 },
  { name: "extraction:page", retryLimit: 3, retryDelay: 30, expireInSeconds: 60 },
  { name: "extraction:apify-start", retryLimit: 3, retryDelay: 30, expireInSeconds: 60 },
  { name: "extraction:poll", retryLimit: 5, retryDelay: 15, expireInSeconds: 60 },
  { name: "extraction:ingest", retryLimit: 3, retryDelay: 20, expireInSeconds: 60 },
  { name: "enrich:deep", retryLimit: 2, retryDelay: 30, expireInSeconds: 120 },
] as const satisfies readonly (PgBoss.Queue & { name: string })[];

/**
 * pg-boss v10 requires explicit queue creation before send() — without it, send() does an
 * INNER JOIN against pgboss.queue, finds nothing, and returns null silently.
 *
 * createQueue() is a no-op when the queue already exists — including when it exists with
 * *different* options. extraction:start and extraction:page were created in April 2026
 * without any policy and kept retry_limit = null ever since, because every later
 * createQueue() call silently did nothing. Only the worker role reconciles the policy
 * (updateQueue), so a producer request never pays for six extra UPDATEs.
 */
async function ensureQueues(boss: PgBoss, role: BossRole): Promise<void> {
  await Promise.all(
    QUEUE_DEFINITIONS.map(async (queue) => {
      const options: PgBoss.Queue = {
        name: queue.name,
        retryLimit: queue.retryLimit,
        retryDelay: queue.retryDelay,
        retryBackoff: true,
        expireInSeconds: queue.expireInSeconds,
      };
      await boss.createQueue(queue.name, options);
      if (role === "worker") await boss.updateQueue(queue.name, options);
    }),
  );
}

export async function getBoss(options?: { role?: BossRole }): Promise<PgBoss> {
  const role: BossRole = options?.role ?? "producer";

  g.__pgBossPromises ??= {};
  const cached = g.__pgBossPromises[role];
  if (cached) return cached;

  // Inside a worker process the job handlers enqueue follow-up jobs (poll → ingest, and
  // the Google Places fallback) through the default producer role. Reuse the worker's
  // instance rather than opening a second connection pool for the same process — a
  // worker boss can do everything a producer boss can.
  if (role === "producer" && g.__pgBossPromises.worker) return g.__pgBossPromises.worker;

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for pg-boss");
  }

  const connectionString = process.env.DATABASE_URL;
  const useSSL = process.env.DATABASE_SSL === "require";
  const isWorker = role === "worker";

  const promise = (async () => {
    const boss = new PgBoss({
      connectionString,
      ssl: useSSL,
      // Maintenance (archive/delete) and cron belong to the worker only — a producer
      // running them would burn its request budget on housekeeping.
      supervise: isWorker,
      schedule: false,
      migrate: true,
      // Retention: keep completed jobs for 3 days for observability
      deleteAfterDays: 3,
      archiveCompletedAfterSeconds: 60 * 60 * 24, // 24h
      ...(isWorker ? { monitorStateIntervalSeconds: 30 } : {}),
    });

    await boss.start();
    await ensureQueues(boss, role);

    console.log(`[pg-boss] started successfully (role=${role})`);
    return boss;
  })();

  // Don't cache a rejected boot — a transient DB blip would otherwise poison the
  // singleton for the whole lifetime of the instance.
  promise.catch(() => {
    if (g.__pgBossPromises?.[role] === promise) delete g.__pgBossPromises[role];
  });

  g.__pgBossPromises[role] = promise;
  return promise;
}
