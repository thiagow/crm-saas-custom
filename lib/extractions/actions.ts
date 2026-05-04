"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth, getIsOwner } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { forProject } from "@/lib/db/for-project";
import { extractionResults, extractions, leads, projects } from "@/db/schema";
import { requireRole } from "@/lib/auth/rbac";
import { estimateExtractionCost } from "@/lib/google-places/client";
import { z } from "zod";

const MAX_PER_DAY = parseInt(process.env.MAX_EXTRACTIONS_PER_DAY ?? "20", 10);
const MAX_RESULTS = parseInt(process.env.MAX_RESULTS_PER_EXTRACTION ?? "200", 10);

const createExtractionSchema = z.object({
  projectSlug: z.string(),
  query: z.string().min(2).max(100),
  city: z.string().min(2).max(80),
  state: z.string().min(2).max(50),
  radiusMeters: z.number().int().positive().max(50000).optional(),
  maxResults: z.number().int().min(1).max(MAX_RESULTS).default(100),
});

export async function createExtraction(input: z.infer<typeof createExtractionSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const data = createExtractionSchema.parse(input);

  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, data.projectSlug),
    columns: { id: true },
  });
  if (!project) throw new Error("Project not found");

  await requireRole(session.user.id, project.id, "sales", getIsOwner(session));

  // Enqueue the extraction job
  const [extraction] = await db
    .insert(extractions)
    .values({
      projectId: project.id,
      query: data.query,
      city: data.city,
      state: data.state,
      radiusMeters: data.radiusMeters,
      maxResults: data.maxResults,
      status: "queued",
    })
    .returning();

  if (!extraction) throw new Error("Failed to create extraction");

  // Enqueue in pg-boss
  const { getBoss } = await import("@/lib/jobs/boss");
  const boss = await getBoss();

  let jobId: string | null = null;
  try {
    jobId = await boss.send("extraction:start", {
      extractionId: extraction.id,
      query: data.query,
      city: data.city,
      state: data.state,
      radiusMeters: data.radiusMeters,
      maxResults: data.maxResults,
      processed: undefined,
      pageToken: undefined,
    });

    // pg-boss v10: send() returns null se a fila nao existe. Tratar como erro critico.
    if (jobId === null) {
      throw new Error("Fila de jobs nao disponível — boss.send() retornou null. Job scheduler pode nao estar rodando.");
    }
  } catch (sendErr) {
    // Enfileiramento falhou — marcar como failed para evitar registro órfão
    console.error("[extraction] boss.send() failed:", sendErr);
    await db
      .update(extractions)
      .set({
        status: "failed",
        errorMessage: "Falha ao enfileirar job: " + (sendErr instanceof Error ? sendErr.message : String(sendErr)),
        finishedAt: new Date(),
      })
      .where(eq(extractions.id, extraction.id));
    throw new Error("Falha ao iniciar extração. Verifique a conexão e tente novamente.");
  }

  // Store job reference
  if (jobId) {
    await db
      .update(extractions)
      .set({ jobId })
      .where(eq(extractions.id, extraction.id));
  }

  revalidatePath(`/${data.projectSlug}/extractions`);
  return extraction;
}

export async function getExtractions(projectSlug: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, projectSlug),
    columns: { id: true },
  });
  if (!project) throw new Error("Project not found");

  await forProject(project.id, session.user.id, getIsOwner(session));

  return db.query.extractions.findMany({
    where: eq(extractions.projectId, project.id),
    orderBy: [desc(extractions.createdAt)],
    limit: 50,
  });
}

export async function cancelExtraction(extractionId: string, projectSlug: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, projectSlug),
    columns: { id: true },
  });
  if (!project) throw new Error("Project not found");

  await requireRole(session.user.id, project.id, "sales");

  const extraction = await db.query.extractions.findFirst({
    where: and(eq(extractions.id, extractionId), eq(extractions.projectId, project.id)),
    columns: { id: true, status: true },
  });

  if (!extraction) throw new Error("Extraction not found");
  if (extraction.status !== "queued" && extraction.status !== "running") {
    throw new Error("Only active extractions can be cancelled");
  }

  await db
    .update(extractions)
    .set({ status: "cancelled" })
    .where(eq(extractions.id, extractionId));

  revalidatePath(`/${projectSlug}/extractions`);
}

export async function getExtractionStatus(extractionId: string, projectSlug: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, projectSlug),
    columns: { id: true },
  });
  if (!project) throw new Error("Project not found");

  await forProject(project.id, session.user.id, getIsOwner(session));

  return db.query.extractions.findFirst({
    where: and(eq(extractions.id, extractionId), eq(extractions.projectId, project.id)),
  });
}


// ─── Triage actions ───────────────────────────────────────────────────────────

const getTriageResultsSchema = z.object({
  projectSlug: z.string(),
  extractionId: z.string().optional(),
  hasPhone: z.boolean().optional(),
  hasSite: z.boolean().optional(),
  hasInstagram: z.boolean().optional(),
  minRating: z.number().optional(),
  minReviews: z.number().optional(),
  orderBy: z.enum(["rating", "reviews", "name"]).default("rating"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});

export async function getTriageResults(input: z.infer<typeof getTriageResultsSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const data = getTriageResultsSchema.parse(input);

  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, data.projectSlug),
    columns: { id: true },
  });
  if (!project) throw new Error("Project not found");

  await forProject(project.id, session.user.id, getIsOwner(session));

  // Build filter conditions
  const { sql, isNotNull, isNull, gte, like } = await import("drizzle-orm");

  const conditions = [
    eq(extractionResults.projectId, project.id),
    eq(extractionResults.status, "pending"),
    ...(data.extractionId ? [eq(extractionResults.extractionId, data.extractionId)] : []),
    ...(data.hasPhone ? [isNotNull(extractionResults.phone)] : []),
    ...(data.hasSite ? [isNotNull(extractionResults.website)] : []),
    ...(data.hasInstagram ? [isNotNull(extractionResults.instagramHandle)] : []),
    ...(data.minRating ? [gte(extractionResults.rating, data.minRating)] : []),
    ...(data.minReviews ? [gte(extractionResults.reviewsCount, data.minReviews)] : []),
  ];

  const orderField =
    data.orderBy === "rating"
      ? desc(extractionResults.rating)
      : data.orderBy === "reviews"
        ? desc(extractionResults.reviewsCount)
        : extractionResults.name;

  const offset = (data.page - 1) * data.pageSize;

  const results = await db.query.extractionResults.findMany({
    where: and(...conditions),
    orderBy: [orderField],
    limit: data.pageSize,
    offset,
    with: { extraction: { columns: { query: true, city: true, createdAt: true } } },
  });

  return results;
}

const promoteLeadsSchema = z.object({
  projectSlug: z.string(),
  resultIds: z.array(z.string()).min(1).max(100),
  stageId: z.string(),
});

export async function promoteResultsToLeads(input: z.infer<typeof promoteLeadsSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const data = promoteLeadsSchema.parse(input);

  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, data.projectSlug),
    columns: { id: true },
  });
  if (!project) throw new Error("Project not found");

  await requireRole(session.user.id, project.id, "sales");

  // Fetch only the requested results (not the entire table)
  const toPromote = await db.query.extractionResults.findMany({
    where: and(
      eq(extractionResults.projectId, project.id),
      eq(extractionResults.status, "pending"),
      inArray(extractionResults.id, data.resultIds),
    ),
    columns: {
      id: true, name: true, city: true, state: true, phone: true,
      website: true, instagramHandle: true, placeId: true,
    },
  });
  if (toPromote.length === 0) return { promoted: 0 };

  // Create leads
  const createdLeads = await db
    .insert(leads)
    .values(
      toPromote.map((r) => ({
        projectId: project.id,
        stageId: data.stageId,
        name: r.name,
        company: r.name,
        city: r.city ?? undefined,
        state: r.state ?? undefined,
        phone: r.phone ?? undefined,
        website: r.website ?? undefined,
        instagramHandle: r.instagramHandle ?? undefined,
        source: "google_maps" as const,
        placeId: r.placeId,
        tags: [],
        customFields: {},
      })),
    )
    .returning({ id: leads.id });

  // Parallel updates — each result maps to a different promotedLeadId
  await Promise.all(
    toPromote.map((result, i) => {
      const lead = createdLeads[i];
      if (!lead) return Promise.resolve();
      return db
        .update(extractionResults)
        .set({ status: "promoted", promotedLeadId: lead.id })
        .where(eq(extractionResults.id, result.id));
    }),
  );

  revalidatePath(`/${data.projectSlug}/triage`);
  revalidatePath(`/${data.projectSlug}/kanban`);

  return { promoted: createdLeads.length };
}

export async function discardResults(input: { resultIds: string[]; projectSlug: string }) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, input.projectSlug),
    columns: { id: true },
  });
  if (!project) throw new Error("Project not found");

  await requireRole(session.user.id, project.id, "sales");

  await db
    .update(extractionResults)
    .set({ status: "discarded" })
    .where(
      and(
        inArray(extractionResults.id, input.resultIds),
        eq(extractionResults.projectId, project.id),
      ),
    );

  revalidatePath(`/${input.projectSlug}/triage`);
}

const updateExtractionResultSchema = z.object({
  resultId: z.string(),
  projectSlug: z.string(),
  name: z.string().min(1).max(200),
  phone: z.string().max(50).optional().or(z.literal("")),
  website: z.string().url().optional().or(z.literal("")),
  instagramHandle: z.string().max(100).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  state: z.string().max(50).optional().or(z.literal("")),
});

export async function updateExtractionResult(input: z.infer<typeof updateExtractionResultSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const data = updateExtractionResultSchema.parse(input);

  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, data.projectSlug),
    columns: { id: true },
  });
  if (!project) throw new Error("Project not found");

  await requireRole(session.user.id, project.id, "sales", getIsOwner(session));

  const result = await db.query.extractionResults.findFirst({
    where: and(
      eq(extractionResults.id, data.resultId),
      eq(extractionResults.projectId, project.id),
      eq(extractionResults.status, "pending"),
    ),
    columns: { id: true },
  });
  if (!result) throw new Error("Result not found or not editable");

  await db
    .update(extractionResults)
    .set({
      name: data.name,
      phone: data.phone || null,
      website: data.website || null,
      instagramHandle: data.instagramHandle || null,
      city: data.city || null,
      state: data.state || null,
    })
    .where(eq(extractionResults.id, data.resultId));
}
