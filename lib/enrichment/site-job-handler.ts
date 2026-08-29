/**
 * pg-boss handler for the `enrich:site` queue — the free contact-enrichment pass.
 *
 * Enqueued at the end of a successful ingest (lib/apify/job-handler.ts) for the results
 * that have a real website but still lack an Instagram handle or e-mail. Processes a small
 * batch per job so each invocation fits the worker's 8s budget (lib/jobs/dispatch.ts);
 * whatever is left over is re-enqueued as another batch.
 */
import { extractionResults } from "@/db/schema";
import { db } from "@/lib/db/client";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { enrichFromSite } from "./site-enrich";

/** Sites crawled per job. Four sites × ~1.5s worst case sits inside the 8s worker budget. */
const BATCH_SIZE = 4;

export interface SiteEnrichJobData {
  extractionId: string;
  projectId: string;
}

export async function handleSiteEnrich(data: SiteEnrichJobData): Promise<void> {
  const { extractionId, projectId } = data;

  // Claim a batch atomically: flip enrichment_state to 'running' with RETURNING, so two
  // workers pulling the same queue can never crawl the same rows twice.
  const claimed = await db
    .update(extractionResults)
    .set({ siteEnrichedAt: new Date() })
    .where(
      inArray(
        extractionResults.id,
        db
          .select({ id: extractionResults.id })
          .from(extractionResults)
          .where(
            and(
              eq(extractionResults.extractionId, extractionId),
              eq(extractionResults.projectId, projectId),
              isNull(extractionResults.siteEnrichedAt),
              isNotNull(extractionResults.website),
              // Only rows still missing something this pass can supply.
              or(isNull(extractionResults.instagramHandle), isNull(extractionResults.email)),
            ),
          )
          .limit(BATCH_SIZE),
      ),
    )
    .returning({
      id: extractionResults.id,
      name: extractionResults.name,
      website: extractionResults.website,
      instagramHandle: extractionResults.instagramHandle,
      email: extractionResults.email,
      whatsappNumber: extractionResults.whatsappNumber,
      whatsappStatus: extractionResults.whatsappStatus,
    });

  if (claimed.length === 0) return;

  for (const row of claimed) {
    if (!row.website) continue;

    const found = await enrichFromSite({ website: row.website, businessName: row.name });

    // Never overwrite a value that is already there — this pass only fills gaps. Anything
    // stronger (a manual edit, a deep-search result) must win over a site guess.
    const updates: Partial<typeof extractionResults.$inferInsert> = {};

    if (!row.instagramHandle && found.instagramHandle) {
      updates.instagramHandle = found.instagramHandle;
      updates.instagramSource = "site_crawl";
    }
    if (!row.email && found.emails.length > 0) {
      updates.email = found.emails[0] ?? null;
      updates.emails = found.emails;
    }
    if (!row.whatsappNumber && found.whatsappNumbers.length > 0) {
      updates.whatsappNumber = found.whatsappNumbers[0] ?? null;
      // A number the business published behind a wa.me link is stated, not inferred.
      updates.whatsappStatus = "likely";
    }

    if (Object.keys(updates).length > 0) {
      await db.update(extractionResults).set(updates).where(eq(extractionResults.id, row.id));
    }
  }

  // More rows waiting? Queue the next batch. Imported lazily to keep this module free of
  // a static dependency on the queue layer, matching lib/apify/job-handler.ts.
  const [remaining] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(extractionResults)
    .where(
      and(
        eq(extractionResults.extractionId, extractionId),
        isNull(extractionResults.siteEnrichedAt),
        isNotNull(extractionResults.website),
        or(isNull(extractionResults.instagramHandle), isNull(extractionResults.email)),
      ),
    );

  if ((remaining?.count ?? 0) > 0) {
    const { getBoss } = await import("@/lib/jobs/boss");
    const boss = await getBoss();
    await boss.send("enrich:site", { extractionId, projectId } satisfies SiteEnrichJobData);
  }
}
