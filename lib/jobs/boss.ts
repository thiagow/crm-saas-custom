/**
 * pg-boss singleton for job queue.
 * pg-boss stores job state in Postgres tables (prefixed with pgboss.*).
 * Tables are auto-created on first start().
 *
 * We keep a module-level promise to avoid re-initializing on every Function invocation
 * within the same Node.js process lifetime (Netlify may reuse warm instances).
 */
import PgBoss from "pg-boss";

let bossPromise: Promise<PgBoss> | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (bossPromise) return bossPromise;

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for pg-boss");
  }

  const connectionString = process.env.DATABASE_URL;
  const useSSL = process.env.DATABASE_SSL === "require";

  bossPromise = (async () => {
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
    return boss;
  })();

  return bossPromise;
}
