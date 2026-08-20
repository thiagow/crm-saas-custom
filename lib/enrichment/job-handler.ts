import { extractionResults } from "@/db/schema";
import { db } from "@/lib/db/client";
/**
 * pg-boss handler for the "pesquisa profunda" (deep-search) queue — processes a small
 * chunk of extraction_results, running the CNPJ/QSA owner lookup on each one.
 * Synchronous per result (no Apify run), so a chunk of up to 5 fits comfortably in one
 * job invocation. Each result's outcome is persisted individually — one failure in a
 * chunk never loses the successes that already landed.
 */
import { eq, inArray } from "drizzle-orm";
import { runDeepSearch } from "./deep-search";

export interface EnrichDeepJobData {
  resultIds: string[];
}

export async function handleEnrichDeep(data: EnrichDeepJobData): Promise<void> {
  const { resultIds } = data;
  if (resultIds.length === 0) return;

  await db
    .update(extractionResults)
    .set({ deepStatus: "running" })
    .where(inArray(extractionResults.id, resultIds));

  const results = await db.query.extractionResults.findMany({
    where: inArray(extractionResults.id, resultIds),
    columns: { id: true, name: true, city: true, state: true, website: true, cnpj: true },
  });

  for (const result of results) {
    try {
      const outcome = await runDeepSearch({
        name: result.name,
        city: result.city,
        state: result.state,
        website: result.website,
        knownCnpj: result.cnpj,
      });

      await db
        .update(extractionResults)
        .set({
          deepStatus: outcome.status,
          deepEnrichedAt: new Date(),
          deepError: outcome.error,
          cnpj: outcome.cnpj ?? result.cnpj,
          legalName: outcome.legalName,
          cnaeDescription: outcome.cnaeDescription,
          companyStatus: outcome.companyStatus,
          cnpjConfidence: outcome.cnpjConfidence,
          ownerName: outcome.ownerName,
          ownerRole: outcome.ownerRole,
          ownerEmail: outcome.ownerEmail,
        })
        .where(eq(extractionResults.id, result.id));
    } catch (err) {
      console.error(`[enrich:deep] result ${result.id} failed:`, err);
      await db
        .update(extractionResults)
        .set({
          deepStatus: "failed",
          deepEnrichedAt: new Date(),
          deepError: err instanceof Error ? err.message : String(err),
        })
        .where(eq(extractionResults.id, result.id));
      // Don't re-throw — this is a best-effort loop over independent results; one
      // failure shouldn't cause pg-boss to retry the whole chunk (and redo the
      // successful ones' work at the caller's expense).
    }
  }
}
