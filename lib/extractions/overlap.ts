/**
 * Detects when a new extraction would re-cover ground the project already paid for.
 *
 * The problem this solves: `extraction_results` has a unique index on
 * (project_id, place_id) and the ingest uses onConflictDoNothing, so re-running the same
 * search silently inserts nothing. Apify still bills for every place it scraped. The
 * user sees "0 new" with no explanation and no way to know it would happen beforehand.
 *
 * Apify offers no offset or pagination — a re-run returns roughly the same places in the
 * same order, so there is no "next page" to ask for. The only way to reach new businesses
 * is to cover a different slice: another rating band, only places without a website,
 * another postal code, a different term. This module reports the collision and proposes
 * those slices; lib/apify/job-handler.ts handles the case where the user runs anyway.
 */
import { type ExtractionFilters, extractionResults, extractions } from "@/db/schema";
import { db } from "@/lib/db/client";
import { and, desc, eq, sql } from "drizzle-orm";

/** Lowercase, strip accents, collapse whitespace — so "Clínica  de Estética " and
 *  "clinica de estetica" are recognised as the same search. */
export function normalizeQuery(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The identity of a search: same key ⇒ same ground covered. */
export function buildFilters(input: {
  query: string;
  filters?: Omit<ExtractionFilters, "normalizedQuery"> | undefined;
}): ExtractionFilters {
  return {
    normalizedQuery: normalizeQuery(input.query),
    websiteFilter: input.filters?.websiteFilter ?? "allPlaces",
    minStars: input.filters?.minStars ?? "",
    searchMatching: input.filters?.searchMatching ?? "all",
    ...(input.filters?.postalCode ? { postalCode: input.filters.postalCode } : {}),
  };
}

function sameSlice(a: ExtractionFilters, b: ExtractionFilters): boolean {
  return (
    (a.websiteFilter ?? "allPlaces") === (b.websiteFilter ?? "allPlaces") &&
    (a.minStars ?? "") === (b.minStars ?? "") &&
    (a.searchMatching ?? "all") === (b.searchMatching ?? "all") &&
    (a.postalCode ?? "") === (b.postalCode ?? "")
  );
}

export interface PartitionSuggestion {
  /** Stable id the UI uses to apply the suggestion to the form. */
  id: "withoutWebsite" | "fourStars" | "onlyIncludes" | "postalCode";
  label: string;
  hint: string;
  filters: Omit<ExtractionFilters, "normalizedQuery">;
}

export interface OverlapReport {
  /** True when an earlier extraction covered exactly this slice. */
  alreadyRan: boolean;
  lastRunAt: Date | null;
  /** Completed extractions of this same slice. */
  previousRuns: number;
  /** Places from this city/state already stored for the project — the likely repeat set. */
  placesInBase: number;
  suggestions: PartitionSuggestion[];
}

/**
 * Suggestions are only useful if they lead somewhere new, so each one is a slice the
 * project has *not* already run. "withoutWebsite" is first on purpose: a business with no
 * website is both un-extracted ground and a stronger lead.
 */
function buildSuggestions(
  used: ExtractionFilters[],
  current: ExtractionFilters,
): PartitionSuggestion[] {
  const candidates: PartitionSuggestion[] = [
    {
      id: "withoutWebsite",
      label: "Só empresas sem site",
      hint: "Fatia ainda não coberta — e quem não tem site costuma ser lead melhor.",
      filters: { websiteFilter: "withoutWebsite" },
    },
    {
      id: "fourStars",
      label: "Só 4+ estrelas",
      hint: "Restringe a busca a estabelecimentos mais bem avaliados.",
      filters: { minStars: "four" },
    },
    {
      id: "onlyIncludes",
      label: "Só quem tem o termo no nome",
      hint: 'Ex.: apenas negócios com "Estética" no próprio nome.',
      filters: { searchMatching: "only_includes" },
    },
  ];

  return candidates.filter((candidate) => {
    const slice = { ...current, ...candidate.filters };
    return !used.some((u) => sameSlice(u, slice));
  });
}

export async function getOverlapReport(input: {
  projectId: string;
  query: string;
  city: string;
  state: string;
  filters?: Omit<ExtractionFilters, "normalizedQuery"> | undefined;
}): Promise<OverlapReport> {
  const current = buildFilters({ query: input.query, filters: input.filters });
  const normalizedQuery = current.normalizedQuery ?? "";

  // Only successful runs count as "covered". A failed or cancelled run stored nothing,
  // so blocking a retry because of it would be wrong.
  const priorRuns = await db
    .select({ filters: extractions.filters, createdAt: extractions.createdAt })
    .from(extractions)
    .where(
      and(
        eq(extractions.projectId, input.projectId),
        eq(extractions.status, "completed"),
        sql`lower(${extractions.city}) = lower(${input.city})`,
        sql`lower(${extractions.state}) = lower(${input.state})`,
      ),
    )
    .orderBy(desc(extractions.createdAt));

  // Legacy rows (pre-`filters`) have an empty object. Fall back to the raw query text so
  // extractions created before this feature still participate in the check.
  const sameQueryRuns = priorRuns.filter(
    (run) => (run.filters?.normalizedQuery ?? "") === normalizedQuery,
  );
  const matching = sameQueryRuns.filter((run) => sameSlice(run.filters ?? {}, current));

  const [counted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(extractionResults)
    .where(
      and(
        eq(extractionResults.projectId, input.projectId),
        sql`lower(${extractionResults.city}) = lower(${input.city})`,
      ),
    );

  return {
    alreadyRan: matching.length > 0,
    lastRunAt: matching[0]?.createdAt ?? null,
    previousRuns: matching.length,
    placesInBase: counted?.count ?? 0,
    suggestions: buildSuggestions(
      sameQueryRuns.map((r) => r.filters ?? {}),
      current,
    ),
  };
}
