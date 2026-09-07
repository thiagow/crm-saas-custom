"use server";

import { extractionResults, projects } from "@/db/schema";
import { auth, getIsOwner } from "@/lib/auth";
import { requireRole } from "@/lib/auth/rbac";
import { db } from "@/lib/db/client";
import { and, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const deepEnrichSchema = z.object({
  projectSlug: z.string(),
  resultIds: z.array(z.string()).min(1).max(50),
  /** Also fetch Instagram detail (bio, followers, e-mail-in-bio) — one paid Apify run
   *  per result (~US$0.10/profile on the Free tier, see lib/apify/cost.ts). Opt-in and
   *  shown to the user before running (components/extractions/triage-table.tsx). */
  instagram: z.boolean().optional(),
});

/**
 * Queues "pesquisa profunda" (CNPJ/QSA owner lookup, optionally + Instagram detail) for
 * the given results.
 *
 * The UPDATE ... WHERE project_id = $tenant ... RETURNING id does three things in one
 * query: filters by tenant (anti-IDOR — a caller can never enrich another project's
 * results, no matter what ids it sends), claims the rows atomically (idempotent against
 * pg-boss's at-least-once delivery — a result already queued/running is skipped), and
 * gives an exact count of what actually got queued vs. skipped.
 */
export async function deepEnrichResults(
  input: z.infer<typeof deepEnrichSchema>,
): Promise<{ queued: number; skipped: number }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const data = deepEnrichSchema.parse(input);

  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, data.projectSlug),
    columns: { id: true },
  });
  if (!project) throw new Error("Project not found");

  await requireRole(session.user.id, project.id, "sales", getIsOwner(session));

  const claimed = await db
    .update(extractionResults)
    .set({ deepStatus: "queued", deepError: null })
    .where(
      and(
        inArray(extractionResults.id, data.resultIds),
        eq(extractionResults.projectId, project.id),
        eq(extractionResults.status, "pending"),
        notInArray(extractionResults.deepStatus, ["queued", "running"]),
      ),
    )
    .returning({ id: extractionResults.id });

  if (claimed.length === 0) {
    return { queued: 0, skipped: data.resultIds.length };
  }

  const { getBoss } = await import("@/lib/jobs/boss");
  const boss = await getBoss();

  for (const ids of chunk(
    claimed.map((c) => c.id),
    5,
  )) {
    await boss.send("enrich:deep", { resultIds: ids }, { singletonKey: `deep:${ids.join(",")}` });
  }

  if (data.instagram) {
    // Claimed separately from the CNPJ step above (own status column, own tenant-scoped
    // claim) — a caller can ask for CNPJ only, Instagram only, or both in one call.
    const igClaimed = await db
      .update(extractionResults)
      .set({ instagramDeepStatus: "queued", instagramDeepError: null })
      .where(
        and(
          inArray(extractionResults.id, data.resultIds),
          eq(extractionResults.projectId, project.id),
          eq(extractionResults.status, "pending"),
          notInArray(extractionResults.instagramDeepStatus, ["queued", "running"]),
        ),
      )
      .returning({ id: extractionResults.id });

    for (const row of igClaimed) {
      await boss.send(
        "enrich:instagram-start",
        { resultId: row.id },
        { singletonKey: `ig-deep-start:${row.id}` },
      );
    }
  }

  revalidatePath(`/${data.projectSlug}/triage`);
  return { queued: claimed.length, skipped: data.resultIds.length - claimed.length };
}

const validateEmailsSchema = z.object({
  projectSlug: z.string(),
  resultIds: z.array(z.string()).min(1).max(50),
});

/** Queues Bouncer validation (lib/enrichment/bouncer.ts) for the given results' `email`.
 *  Same anti-IDOR/idempotent claim pattern as deepEnrichResults. Skips rows with no
 *  e-mail to check — there's nothing to validate and no credit should be spent. */
export async function validateEmails(
  input: z.infer<typeof validateEmailsSchema>,
): Promise<{ queued: number; skipped: number }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const data = validateEmailsSchema.parse(input);

  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, data.projectSlug),
    columns: { id: true },
  });
  if (!project) throw new Error("Project not found");

  await requireRole(session.user.id, project.id, "sales", getIsOwner(session));

  const claimed = await db
    .update(extractionResults)
    .set({ emailValidationStatus: "queued" })
    .where(
      and(
        inArray(extractionResults.id, data.resultIds),
        eq(extractionResults.projectId, project.id),
        isNotNull(extractionResults.email),
        notInArray(extractionResults.emailValidationStatus, ["queued"]),
      ),
    )
    .returning({ id: extractionResults.id });

  if (claimed.length === 0) {
    return { queued: 0, skipped: data.resultIds.length };
  }

  const { getBoss } = await import("@/lib/jobs/boss");
  const boss = await getBoss();

  for (const ids of chunk(
    claimed.map((c) => c.id),
    10,
  )) {
    await boss.send(
      "enrich:validate-email",
      { resultIds: ids },
      { singletonKey: `validate-email:${ids.join(",")}` },
    );
  }

  revalidatePath(`/${data.projectSlug}/triage`);
  return { queued: claimed.length, skipped: data.resultIds.length - claimed.length };
}

const getEnrichmentStatusSchema = z.object({
  projectSlug: z.string(),
  resultIds: z.array(z.string()).min(1).max(50),
});

/** Polled by the triage UI while results have deepStatus in ('queued','running'). */
export async function getEnrichmentStatus(input: z.infer<typeof getEnrichmentStatusSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const data = getEnrichmentStatusSchema.parse(input);

  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, data.projectSlug),
    columns: { id: true },
  });
  if (!project) throw new Error("Project not found");

  return db.query.extractionResults.findMany({
    where: and(
      inArray(extractionResults.id, data.resultIds),
      eq(extractionResults.projectId, project.id), // anti-IDOR
    ),
    columns: {
      id: true,
      deepStatus: true,
      deepError: true,
      ownerName: true,
      ownerRole: true,
      ownerEmail: true,
      cnpj: true,
      legalName: true,
      cnpjConfidence: true,
      instagramDeepStatus: true,
      instagramDeepError: true,
      instagramHandle: true,
      instagramFollowers: true,
      instagramVerified: true,
      instagramBio: true,
      email: true,
      website: true,
      emailValidationStatus: true,
      emailValidationReason: true,
    },
  });
}
