/**
 * pg-boss handler for the `enrich:validate-email` queue — validates the `email` column
 * against Bouncer for a chunk of extraction_results. Same shape as lib/enrichment/job-handler.ts
 * (CNPJ deep-search): synchronous per result, one HTTP call each, small chunk per job so
 * it fits the worker's time budget (lib/jobs/dispatch.ts), one failure never loses the
 * successes that already landed.
 */
import { extractionResults } from "@/db/schema";
import { db } from "@/lib/db/client";
import { eq, inArray } from "drizzle-orm";
import { verifyEmail } from "./bouncer";

export interface ValidateEmailJobData {
  resultIds: string[];
}

export async function handleValidateEmail(data: ValidateEmailJobData): Promise<void> {
  const { resultIds } = data;
  if (resultIds.length === 0) return;

  const results = await db.query.extractionResults.findMany({
    where: inArray(extractionResults.id, resultIds),
    columns: { id: true, email: true },
  });

  for (const result of results) {
    if (!result.email) {
      // Queued before the address was cleared, or a stale re-delivery — nothing to check.
      await db
        .update(extractionResults)
        .set({ emailValidationStatus: "none", emailValidatedAt: null, emailValidationReason: null })
        .where(eq(extractionResults.id, result.id));
      continue;
    }

    try {
      const outcome = await verifyEmail(result.email);
      await db
        .update(extractionResults)
        .set({
          emailValidationStatus: outcome.status,
          emailValidatedAt: new Date(),
          emailValidationReason: outcome.reason,
        })
        .where(eq(extractionResults.id, result.id));
    } catch (err) {
      console.error(`[enrich:validate-email] result ${result.id} failed:`, err);
      await db
        .update(extractionResults)
        .set({
          emailValidationStatus: "failed",
          emailValidatedAt: new Date(),
          emailValidationReason: err instanceof Error ? err.message : String(err),
        })
        .where(eq(extractionResults.id, result.id));
      // Don't re-throw — independent results in the chunk, same reasoning as enrich:deep.
    }
  }
}
