import { and, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { rateLimitBuckets } from "@/db/schema";

const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_AUTH_MAX ?? "5", 10);
const WINDOW_SECONDS = parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_SECONDS ?? "60", 10);

/**
 * Sliding window rate limiter backed by Postgres.
 * Returns true if the request is allowed, false if rate limited.
 *
 * Trade-off: not atomic under extreme concurrency, but sufficient for MVP.
 * Under load, use Redis + atomic INCR. This is intentionally simple.
 */
export async function checkRateLimit(key: string): Promise<boolean> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + WINDOW_SECONDS * 1000);

  const existing = await db.query.rateLimitBuckets.findFirst({
    where: and(eq(rateLimitBuckets.key, key), gt(rateLimitBuckets.resetAt, now)),
  });

  if (!existing) {
    await db
      .insert(rateLimitBuckets)
      .values({ key, count: 1, resetAt, updatedAt: now })
      .onConflictDoUpdate({
        target: rateLimitBuckets.key,
        set: { count: 1, resetAt, updatedAt: now },
      });
    return true;
  }

  if (existing.count >= MAX_REQUESTS) {
    return false;
  }

  await db
    .update(rateLimitBuckets)
    .set({ count: existing.count + 1, updatedAt: now })
    .where(eq(rateLimitBuckets.key, key));

  return true;
}
