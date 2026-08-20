"use server";

import { extractionResults, projects } from "@/db/schema";
import { auth, getIsOwner } from "@/lib/auth";
import { requireRole } from "@/lib/auth/rbac";
import { db } from "@/lib/db/client";
import { and, eq, inArray, notInArray } from "drizzle-orm";
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
});

/**
 * Queues "pesquisa profunda" (CNPJ/QSA owner lookup) for the given results.
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
    },
  });
}
