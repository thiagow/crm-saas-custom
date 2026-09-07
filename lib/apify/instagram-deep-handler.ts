/**
 * pg-boss handlers for the Instagram-detail step of "pesquisa profunda" — fetches
 * followers/verified/bio for one result's Instagram profile via the same Apify actor
 * used for discovery, scoped to a single place_id (lib/apify/actors.ts buildDeepSearchInput).
 *
 * This is the piece EXTRACTION_PIPELINE_PENDING.md #6 documented as "built but never
 * called" — cut originally because it costs ~US$0.10/profile on the Apify Free tier.
 * It stays opt-in: only enqueued when the caller explicitly asks for Instagram detail
 * (lib/enrichment/actions.ts deepEnrichResults, `instagram: true`), with the cost shown
 * up front via estimateDeepSearchCostUsd (lib/apify/cost.ts).
 *
 * One Apify run per result (the actor has no "many specific place_ids" mode), so this
 * mirrors the extraction pipeline's start/poll split rather than the CNPJ deep-search's
 * synchronous loop (lib/enrichment/job-handler.ts) — a run takes real time and this must
 * fit an 8s worker budget per invocation (lib/jobs/dispatch.ts).
 */
import { extractionResults } from "@/db/schema";
import { db } from "@/lib/db/client";
import { classifyBusinessLink } from "@/lib/enrichment/link-classifier";
import { extractEmails } from "@/lib/enrichment/html-extract";
import { eq } from "drizzle-orm";
import { buildDeepSearchInput } from "./actors";
import { getRun, isTerminalRunStatus, listDatasetItems, startRun } from "./client";
import { type ApifyGoogleMapsItem, pickBestInstagramProfile } from "./mappers";

const MAX_POLL_ATTEMPTS = 20; // ~5 min at the poll cadence below
const POLL_DELAY_SECONDS = 15;

export interface InstagramDeepStartJobData {
  resultId: string;
}
export interface InstagramDeepPollJobData {
  resultId: string;
  pollAttempts?: number;
}

async function fail(resultId: string, message: string): Promise<void> {
  await db
    .update(extractionResults)
    .set({ instagramDeepStatus: "failed", instagramDeepError: message, instagramDeepRunId: null })
    .where(eq(extractionResults.id, resultId));
}

export async function handleInstagramDeepStart(data: InstagramDeepStartJobData): Promise<void> {
  const { resultId } = data;
  const result = await db.query.extractionResults.findFirst({
    where: eq(extractionResults.id, resultId),
    columns: { id: true, placeId: true, instagramDeepStatus: true },
  });
  if (!result) return;
  // Already running/done — a stale re-delivery of this job, not a new request.
  if (result.instagramDeepStatus === "running") return;

  try {
    const run = await startRun({
      actorId: (await import("./actors")).ACTORS.googleMaps,
      input: buildDeepSearchInput({ placeId: result.placeId, instagram: true }),
      maxItems: 1,
      timeoutSecs: 180,
    });

    await db
      .update(extractionResults)
      .set({
        instagramDeepStatus: "running",
        instagramDeepRunId: run.runId,
        instagramDeepError: null,
      })
      .where(eq(extractionResults.id, resultId));

    const { getBoss } = await import("@/lib/jobs/boss");
    const boss = await getBoss();
    await boss.send("enrich:instagram-poll", { resultId } satisfies InstagramDeepPollJobData, {
      singletonKey: `ig-deep:${resultId}`,
      startAfter: POLL_DELAY_SECONDS,
    });
  } catch (err) {
    await fail(resultId, err instanceof Error ? err.message : String(err));
  }
}

export async function handleInstagramDeepPoll(data: InstagramDeepPollJobData): Promise<void> {
  const { resultId } = data;
  const pollAttempts = data.pollAttempts ?? 0;

  const result = await db.query.extractionResults.findFirst({
    where: eq(extractionResults.id, resultId),
    columns: {
      id: true,
      name: true,
      instagramDeepRunId: true,
      instagramHandle: true,
      email: true,
      emails: true,
      website: true,
      socialLinks: true,
    },
  });
  if (!result?.instagramDeepRunId) return;

  try {
    const run = await getRun(result.instagramDeepRunId);

    if (!isTerminalRunStatus(run.status)) {
      if (pollAttempts >= MAX_POLL_ATTEMPTS) {
        await fail(
          resultId,
          `Instagram deep-search não terminou após ${MAX_POLL_ATTEMPTS} tentativas`,
        );
        return;
      }
      const { getBoss } = await import("@/lib/jobs/boss");
      const boss = await getBoss();
      await boss.send(
        "enrich:instagram-poll",
        { resultId, pollAttempts: pollAttempts + 1 } satisfies InstagramDeepPollJobData,
        { singletonKey: `ig-deep:${resultId}`, startAfter: POLL_DELAY_SECONDS },
      );
      return;
    }

    if (run.status !== "SUCCEEDED") {
      await fail(
        resultId,
        `Apify run terminou em ${run.status}${run.statusMessage ? `: ${run.statusMessage}` : ""}`,
      );
      return;
    }

    const { items } = await listDatasetItems<ApifyGoogleMapsItem>({
      datasetId: run.datasetId,
      offset: 0,
      limit: 1,
    });
    const item = items[0];
    const profile = pickBestInstagramProfile(item?.instagramProfiles);

    if (!profile) {
      await db
        .update(extractionResults)
        .set({
          instagramDeepStatus: "partial",
          instagramDeepError: "Nenhum perfil de Instagram encontrado para este resultado",
          instagramDeepRunId: null,
        })
        .where(eq(extractionResults.id, resultId));
      return;
    }

    const updates: Partial<typeof extractionResults.$inferInsert> = {
      instagramDeepStatus: "done",
      instagramDeepRunId: null,
      instagramDeepError: null,
      instagramFollowers: profile.followersCount ?? null,
      instagramVerified: profile.accountVerificationStatus ?? null,
      instagramBio: profile.biography ?? null,
    };
    if (!result.instagramHandle) updates.instagramHandle = profile.username;

    // Two independent places an e-mail can hide in a bio: plain text, and the profile's
    // "external URL" button — which is itself very often a Linktree/Beacons page.
    const bioEmails = profile.biography ? extractEmails(profile.biography) : [];
    if (!result.email && bioEmails.length > 0) {
      updates.email = bioEmails[0] ?? null;
      updates.emails = [...new Set([...(result.emails ?? []), ...bioEmails])];
    }
    if (!result.website && profile.externalUrl) {
      const classified = classifyBusinessLink(profile.externalUrl);
      if (classified?.kind === "website" && classified.url) {
        updates.website = classified.url;
      } else if (
        classified?.kind === "linktree" &&
        classified.url &&
        !result.socialLinks?.linktree
      ) {
        // Feed it to lib/enrichment/site-job-handler.ts rather than crawling it here —
        // that pass already knows how to resolve a linktree page (linktree-resolve.ts).
        // Clear siteEnrichedAt too: if that pass already ran on this row, it did so
        // before this linktree link existed, so it's not "already crawled" for this.
        updates.socialLinks = { ...result.socialLinks, linktree: classified.url };
        updates.siteEnrichedAt = null;
      }
    }

    await db.update(extractionResults).set(updates).where(eq(extractionResults.id, resultId));
  } catch (err) {
    await fail(resultId, err instanceof Error ? err.message : String(err));
  }
}
