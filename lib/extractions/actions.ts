"use server";

import { extractionResults, extractions, leads, projects } from "@/db/schema";
import { estimateExtractionCostUsd } from "@/lib/apify/cost";
import { auth, getIsOwner } from "@/lib/auth";
import { requireRole } from "@/lib/auth/rbac";
import { db } from "@/lib/db/client";
import { forProject } from "@/lib/db/for-project";
import { and, desc, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertExtractionAllowed } from "./limits";
import { buildFilters, getOverlapReport } from "./overlap";

const MAX_RESULTS = Number.parseInt(process.env.MAX_RESULTS_PER_EXTRACTION ?? "200", 10);

/** The partition axes a user can set in the UI — see ExtractionFilters. */
const searchFiltersSchema = z.object({
  websiteFilter: z.enum(["allPlaces", "withWebsite", "withoutWebsite"]).optional(),
  minStars: z
    .enum(["", "two", "twoAndHalf", "three", "threeAndHalf", "four", "fourAndHalf"])
    .optional(),
  searchMatching: z.enum(["all", "only_includes", "only_exact"]).optional(),
  postalCode: z.string().max(12).optional(),
});

const createExtractionSchema = z.object({
  projectSlug: z.string(),
  query: z.string().min(2).max(100),
  city: z.string().min(2).max(80),
  state: z.string().min(2).max(50),
  radiusMeters: z.number().int().positive().max(50000).optional(),
  maxResults: z.number().int().min(1).max(MAX_RESULTS).default(100),
  // Site-contact enrichment (email/social links). Kept on because it costs nothing when
  // it doesn't run, but the pipeline no longer depends on it — see lib/apify/mappers.ts.
  enrichContacts: z.boolean().default(true),
  filters: searchFiltersSchema.optional(),
  /** Set by the UI only after the user acknowledges a duplicate-search warning. */
  acknowledgeDuplicate: z.boolean().default(false),
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

  const filters = buildFilters({ query: data.query, filters: data.filters });

  // Server-side guard, not just a UI nicety: the client warning can be bypassed, and a
  // repeat run costs real money for results the project already owns.
  if (!data.acknowledgeDuplicate) {
    const overlap = await getOverlapReport({
      projectId: project.id,
      query: data.query,
      city: data.city,
      state: data.state,
      filters: data.filters,
    });
    if (overlap.alreadyRan) {
      throw new Error(
        "Esta busca já foi feita para este projeto e vai repetir as mesmas empresas. " +
          "Use um filtro diferente ou confirme que deseja rodar mesmo assim.",
      );
    }
  }

  const estimatedCostUsd = estimateExtractionCostUsd({
    maxResults: data.maxResults,
    enrichContacts: data.enrichContacts,
  });

  // Enqueue the extraction job — Apify is the primary provider (see lib/apify/job-handler.ts);
  // it automatically falls back to Google Places if the Apify run fails.
  //
  // The limit check and the insert share one transaction so the advisory lock covers both:
  // checking the caps and then inserting outside the lock would let two simultaneous
  // clicks each see the same "spent so far" and both pass.
  const extraction = await db.transaction(async (tx) => {
    await assertExtractionAllowed(tx, project.id, estimatedCostUsd);

    const [row] = await tx
      .insert(extractions)
      .values({
        projectId: project.id,
        query: data.query,
        city: data.city,
        state: data.state,
        radiusMeters: data.radiusMeters,
        maxResults: data.maxResults,
        status: "queued",
        provider: "apify",
        enrichContacts: data.enrichContacts,
        filters,
        estimatedCostUsd,
      })
      .returning();
    return row;
  });

  if (!extraction) throw new Error("Failed to create extraction");

  // Enqueue in pg-boss
  const { getBoss } = await import("@/lib/jobs/boss");
  const boss = await getBoss();

  let jobId: string | null = null;
  try {
    jobId = await boss.send("extraction:apify-start", {
      extractionId: extraction.id,
    });

    // pg-boss v10: send() returns null se a fila nao existe. Tratar como erro critico.
    if (jobId === null) {
      throw new Error(
        "Fila de jobs nao disponível — boss.send() retornou null. Job scheduler pode nao estar rodando.",
      );
    }
  } catch (sendErr) {
    // Enfileiramento falhou — marcar como failed para evitar registro órfão
    console.error("[extraction] boss.send() failed:", sendErr);
    await db
      .update(extractions)
      .set({
        status: "failed",
        errorMessage:
          "Falha ao enfileirar job: " +
          (sendErr instanceof Error ? sendErr.message : String(sendErr)),
        finishedAt: new Date(),
      })
      .where(eq(extractions.id, extraction.id));
    throw new Error("Falha ao iniciar extração. Verifique a conexão e tente novamente.");
  }

  // Store job reference
  if (jobId) {
    await db.update(extractions).set({ jobId }).where(eq(extractions.id, extraction.id));
  }

  revalidatePath(`/${data.projectSlug}/extractions`);
  return extraction;
}

/**
 * Pre-flight check for the "Nova extração" modal: would this search re-cover ground the
 * project already paid for, and what different slices are still available?
 *
 * Read-only and safe to call on every keystroke-blur — it never starts a run.
 */
export async function checkExtractionOverlap(input: {
  projectSlug: string;
  query: string;
  city: string;
  state: string;
  filters?: z.infer<typeof searchFiltersSchema> | undefined;
}) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, input.projectSlug),
    columns: { id: true },
  });
  if (!project) throw new Error("Project not found");

  await forProject(project.id, session.user.id, getIsOwner(session));

  if (input.query.trim().length < 2 || input.city.trim().length < 2) {
    return {
      alreadyRan: false,
      lastRunAt: null,
      previousRuns: 0,
      placesInBase: 0,
      suggestions: [],
    };
  }

  return getOverlapReport({
    projectId: project.id,
    query: input.query,
    city: input.city,
    state: input.state,
    filters: input.filters,
  });
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

  await requireRole(session.user.id, project.id, "sales", getIsOwner(session));

  const extraction = await db.query.extractions.findFirst({
    where: and(eq(extractions.id, extractionId), eq(extractions.projectId, project.id)),
    columns: { id: true, status: true },
  });

  if (!extraction) throw new Error("Extraction not found");
  if (extraction.status !== "queued" && extraction.status !== "running") {
    throw new Error("Only active extractions can be cancelled");
  }

  await db.update(extractions).set({ status: "cancelled" }).where(eq(extractions.id, extractionId));

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
  hasEmail: z.boolean().optional(),
  hasWhatsapp: z.boolean().optional(),
  /** Businesses with no website — often the best leads, and invisible before this filter. */
  noSite: z.boolean().optional(),
  /** Unclaimed Google Business Profile — see gbpStatusEnum. */
  gbpUnclaimed: z.boolean().optional(),
  hasOwner: z.boolean().optional(),
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

  const conditions = [
    eq(extractionResults.projectId, project.id),
    eq(extractionResults.status, "pending"),
    ...(data.extractionId ? [eq(extractionResults.extractionId, data.extractionId)] : []),
    ...(data.hasPhone ? [isNotNull(extractionResults.phone)] : []),
    ...(data.hasSite ? [isNotNull(extractionResults.website)] : []),
    ...(data.hasInstagram ? [isNotNull(extractionResults.instagramHandle)] : []),
    ...(data.hasEmail ? [isNotNull(extractionResults.email)] : []),
    ...(data.hasWhatsapp ? [isNotNull(extractionResults.whatsappNumber)] : []),
    ...(data.noSite ? [isNull(extractionResults.website)] : []),
    ...(data.gbpUnclaimed ? [eq(extractionResults.gbpStatus, "unclaimed")] : []),
    ...(data.hasOwner ? [isNotNull(extractionResults.ownerName)] : []),
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

  await requireRole(session.user.id, project.id, "sales", getIsOwner(session));

  // Fetch only the requested results (not the entire table) — full row, so nothing
  // gathered by the extraction/enrichment pipeline is dropped on the way to the lead.
  const toPromote = await db.query.extractionResults.findMany({
    where: and(
      eq(extractionResults.projectId, project.id),
      eq(extractionResults.status, "pending"),
      inArray(extractionResults.id, data.resultIds),
    ),
  });
  if (toPromote.length === 0) return { promoted: 0, alreadyExisted: 0 };

  const { promoted, alreadyExisted } = await db.transaction(async (tx) => {
    // onConflictDoNothing on (project_id, place_id): re-promoting a result whose place
    // was already promoted from a *different* result (e.g. re-extracted after being
    // discarded) must not create a duplicate lead.
    const createdLeads = await tx
      .insert(leads)
      .values(
        toPromote.map((r) => ({
          projectId: project.id,
          stageId: data.stageId,
          name: r.name,
          company: r.name,
          city: r.city ?? undefined,
          state: r.state ?? undefined,
          address: r.address ?? undefined,
          lat: r.lat ?? undefined,
          lng: r.lng ?? undefined,
          category: r.category ?? undefined,
          phone: r.phone ?? undefined,
          whatsapp: r.whatsappNumber ?? undefined,
          phoneType: r.phoneType,
          whatsappStatus: r.whatsappStatus,
          email: r.email ?? undefined,
          website: r.website ?? undefined,
          instagramHandle: r.instagramHandle ?? undefined,
          instagramFollowers: r.instagramFollowers ?? undefined,
          rating: r.rating ?? undefined,
          reviewsCount: r.reviewsCount ?? undefined,
          isOnGoogleMaps: r.isOnGoogleMaps,
          googleMapsUrl: r.googleMapsUrl ?? undefined,
          // Anything added to extraction_results has to be listed here too, or it is
          // silently dropped on promotion — the table below is the only path to `leads`.
          gbpStatus: r.gbpStatus,
          businessProfileId: r.businessProfileId ?? undefined,
          socialLinks: r.socialLinks,
          ownerName: r.ownerName ?? undefined,
          ownerEmail: r.ownerEmail ?? undefined,
          cnpj: r.cnpj ?? undefined,
          legalName: r.legalName ?? undefined,
          source: "google_maps" as const,
          placeId: r.placeId,
          sourceResultId: r.id,
          tags: [],
          customFields: {
            cnaeDescription: r.cnaeDescription,
            companyStatus: r.companyStatus,
            extractionId: r.extractionId,
          },
        })),
      )
      .onConflictDoNothing({ target: [leads.projectId, leads.placeId] })
      .returning({ id: leads.id, placeId: leads.placeId });

    // Match by placeId, not array position — onConflictDoNothing can skip rows,
    // which would silently shift a positional (createdLeads[i]) pairing.
    const leadIdByPlaceId = new Map(createdLeads.map((l) => [l.placeId, l.id]));

    // Places skipped by onConflictDoNothing already have a lead from an earlier
    // promotion — look those up so the result still gets linked/marked promoted
    // instead of being left dangling in "pending".
    const skippedPlaceIds = toPromote
      .map((r) => r.placeId)
      .filter((id) => !leadIdByPlaceId.has(id));
    if (skippedPlaceIds.length > 0) {
      const existing = await tx.query.leads.findMany({
        where: and(eq(leads.projectId, project.id), inArray(leads.placeId, skippedPlaceIds)),
        columns: { id: true, placeId: true },
      });
      for (const l of existing) if (l.placeId) leadIdByPlaceId.set(l.placeId, l.id);
    }

    await Promise.all(
      toPromote.map((result) => {
        const leadId = leadIdByPlaceId.get(result.placeId);
        if (!leadId) return Promise.resolve(); // shouldn't happen, but never crash the batch over one row
        return tx
          .update(extractionResults)
          .set({ status: "promoted", promotedLeadId: leadId })
          .where(eq(extractionResults.id, result.id));
      }),
    );

    return { promoted: createdLeads.length, alreadyExisted: skippedPlaceIds.length };
  });

  revalidatePath(`/${data.projectSlug}/triage`);
  revalidatePath(`/${data.projectSlug}/kanban`);

  return { promoted, alreadyExisted };
}

/**
 * Returns discarded results to triage.
 *
 * Without this, a discarded place is unreachable forever: the unique index on
 * (project_id, place_id) makes the ingest skip it on every future extraction, so it can
 * never come back through a new search. Discarding was effectively irreversible.
 */
export async function reactivateDiscardedResults(input: {
  projectSlug: string;
  /** Scope to one extraction; omit to reactivate every discarded result in the project. */
  extractionId?: string;
}) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, input.projectSlug),
    columns: { id: true },
  });
  if (!project) throw new Error("Project not found");

  await requireRole(session.user.id, project.id, "sales", getIsOwner(session));

  const restored = await db
    .update(extractionResults)
    .set({ status: "pending" })
    .where(
      and(
        eq(extractionResults.projectId, project.id),
        eq(extractionResults.status, "discarded"),
        ...(input.extractionId ? [eq(extractionResults.extractionId, input.extractionId)] : []),
      ),
    )
    .returning({ id: extractionResults.id });

  revalidatePath(`/${input.projectSlug}/triage`);
  return { restored: restored.length };
}

export async function discardResults(input: { resultIds: string[]; projectSlug: string }) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, input.projectSlug),
    columns: { id: true },
  });
  if (!project) throw new Error("Project not found");

  await requireRole(session.user.id, project.id, "sales", getIsOwner(session));

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
