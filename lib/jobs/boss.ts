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
    console.log("[pg-boss] started successfully");
    return boss;
  })();

  return g.__pgBossPromise;
}
