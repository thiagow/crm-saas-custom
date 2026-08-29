import type { SocialLinks } from "@/lib/enrichment/link-classifier";
import { desc } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { leads } from "./leads";
import { projects } from "./projects";

export const phoneTypeEnum = pgEnum("phone_type", ["mobile", "landline", "tollfree", "unknown"]);

/** Heuristic only — see lib/enrichment/phone.ts. "verified" is reserved for a future
 *  real WhatsApp lookup; nothing writes it today. */
export const whatsappStatusEnum = pgEnum("whatsapp_status", [
  "unknown",
  "likely",
  "verified",
  "none",
]);

export const extractionStatusEnum = pgEnum("extraction_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const extractionResultStatusEnum = pgEnum("extraction_result_status", [
  "pending", // Waiting for user review in triage
  "promoted", // Converted to a lead
  "discarded", // User discarded — stays in DB for audit
]);

/** Which service produced this extraction. Apify is primary; google_places is the fallback
 *  used automatically when the Apify run fails (see lib/apify + lib/extractions/handlers). */
export const extractionProviderEnum = pgEnum("extraction_provider", ["apify", "google_places"]);

/** Status of the on-demand "pesquisa profunda" step (Instagram detail + CNPJ/QSA owner
 *  lookup) — separate from the automatic extraction pipeline's own status. */
export const deepSearchStatusEnum = pgEnum("deep_search_status", [
  "none",
  "queued",
  "running",
  "done",
  "partial",
  "failed",
]);

/**
 * Whether the business has claimed its Google Business Profile ("Google Meu Negócio").
 *
 * Derived from the Apify item's `claimThisBusiness` flag — Google renders a "Claim this
 * business" affordance only on unclaimed profiles. Verified against 99 real results on
 * 2026-08-28: the correlation with `businessProfileId` was exact (94 claimed rows all had
 * an id, 5 unclaimed rows all lacked one), so the two signals corroborate each other.
 *
 * Not the same thing as `isOnGoogleMaps`, which only says the place isn't permanently
 * closed and is therefore true for every row a Maps search can return.
 */
export const gbpStatusEnum = pgEnum("gbp_status", ["claimed", "unclaimed", "unknown"]);

/**
 * The search axes stored in `extractions.filters`.
 *
 * Apify has no offset/pagination — every run restarts from scratch and returns roughly
 * the same places in the same order, so "get results 101-150" does not exist. The only
 * way to reach new businesses is to cover a *different* slice of the space. These are
 * the levers the compass/google-maps-extractor actor actually exposes (verified against
 * its input schema on 2026-08-28); together they form the identity of a search.
 */
export interface ExtractionFilters {
  /** Lowercased, accent-stripped, whitespace-collapsed query — the comparison key. */
  normalizedQuery?: string | undefined;
  /** Restrict to places with or without a website. "withoutWebsite" is a strong lead filter. */
  websiteFilter?: "allPlaces" | "withWebsite" | "withoutWebsite" | undefined;
  /** Apify's rating band — the actor's own enum, not a free-form string. */
  minStars?:
    | ""
    | "two"
    | "twoAndHalf"
    | "three"
    | "threeAndHalf"
    | "four"
    | "fourAndHalf"
    | undefined;
  /** Narrows the search area to a single postal code (never combined with city). */
  postalCode?: string | undefined;
  /** How the search term must match the place title. */
  searchMatching?: "all" | "only_includes" | "only_exact" | undefined;
}

export const extractions = pgTable(
  "extractions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Search parameters
    query: text("query").notNull(), // e.g. "academia de muay thai"
    city: text("city").notNull(),
    state: text("state").notNull(),
    radiusMeters: integer("radius_meters"),
    maxResults: integer("max_results").notNull().default(100),
    // Status & progress
    status: extractionStatusEnum("status").notNull().default("queued"),
    totalFound: integer("total_found").default(0).notNull(),
    processed: integer("processed").default(0).notNull(),
    /** Places returned by the provider that were already in the project — see
     *  lib/apify/job-handler.ts. Surfaced in the UI so a wasted re-run is visible
     *  instead of looking like an extraction that simply "found nothing". */
    duplicates: integer("duplicates").default(0).notNull(),
    costUsd: doublePrecision("cost_usd").default(0).notNull(),
    errorMessage: text("error_message"),
    /** The axes that define this search (normalized query, location, provider filters).
     *  Two extractions with equal `filters` cover the same ground — this is what makes
     *  the pre-flight duplicate check in lib/extractions/overlap.ts possible. */
    filters: jsonb("filters").$type<ExtractionFilters>().default({}).notNull(),
    // pg-boss job reference
    jobId: text("job_id"),
    // Provider (Apify primary, Google Places fallback) + run tracking
    provider: extractionProviderEnum("provider").notNull().default("apify"),
    apifyRunId: text("apify_run_id"),
    apifyDatasetId: text("apify_dataset_id"),
    pollAttempts: integer("poll_attempts").default(0).notNull(),
    estimatedCostUsd: doublePrecision("estimated_cost_usd").default(0).notNull(),
    // Whether the automatic site-contact enrichment (email/social links) ran.
    enrichContacts: boolean("enrich_contacts").default(true).notNull(),
    // Timestamps
    startedAt: timestamp("started_at", { mode: "date" }),
    finishedAt: timestamp("finished_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("extractions_project_created_idx").on(t.projectId, desc(t.createdAt))],
);

export const extractionResults = pgTable(
  "extraction_results",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    extractionId: text("extraction_id")
      .notNull()
      .references(() => extractions.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    // Google Places data
    placeId: text("place_id").notNull(),
    name: text("name").notNull(),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    phone: text("phone"),
    website: text("website"),
    instagramHandle: text("instagram_handle"),
    instagramSource: text("instagram_source"), // 'site_parse' | 'google_search' | 'apify' | null
    category: text("category"),
    rating: doublePrecision("rating"),
    reviewsCount: integer("reviews_count"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    photoUrl: text("photo_url"),
    // Contact enrichment (from Apify's scrapeContacts — site crawl, cheap & automatic)
    email: text("email"),
    emails: text("emails").array().default([]).notNull(),
    phoneE164: text("phone_e164"),
    phoneType: phoneTypeEnum("phone_type").notNull().default("unknown"),
    whatsappNumber: text("whatsapp_number"),
    whatsappStatus: whatsappStatusEnum("whatsapp_status").notNull().default("unknown"),
    // Presence
    isOnGoogleMaps: boolean("is_on_google_maps").notNull().default(true),
    googleMapsUrl: text("google_maps_url"),
    /** Whether the Google Business Profile is claimed — see gbpStatusEnum. An unclaimed
     *  profile is a strong sales signal; `isOnGoogleMaps` cannot express this. */
    gbpStatus: gbpStatusEnum("gbp_status").notNull().default("unknown"),
    businessProfileId: text("business_profile_id"),
    /** Social/messaging destinations found in the place's `website` field that are not
     *  Instagram or WhatsApp (those get their own columns). See lib/enrichment/link-classifier.ts. */
    socialLinks: jsonb("social_links").$type<SocialLinks>().default({}).notNull(),
    // Instagram detail (only populated by the paid "pesquisa profunda" deep-search step)
    instagramFollowers: integer("instagram_followers"),
    instagramVerified: boolean("instagram_verified"),
    // Owner / company (from CNPJ lookup — "pesquisa profunda" step, see lib/enrichment/cnpj.ts + receita.ts)
    ownerName: text("owner_name"),
    ownerRole: text("owner_role"), // e.g. "Sócio-Administrador"
    ownerEmail: text("owner_email"),
    cnpj: text("cnpj"), // 14 digits, no punctuation
    legalName: text("legal_name"), // razão social
    cnaeDescription: text("cnae_description"),
    companyStatus: text("company_status"), // situação cadastral
    /** 0..1 confidence that `cnpj` actually belongs to this place — see scoreCnpjMatch().
     *  ownerName/ownerEmail are only ever written when this is >= 0.6 (lib/enrichment/cnpj.ts). */
    cnpjConfidence: doublePrecision("cnpj_confidence"),
    deepStatus: deepSearchStatusEnum("deep_status").notNull().default("none"),
    deepEnrichedAt: timestamp("deep_enriched_at", { mode: "date" }),
    deepError: text("deep_error"),
    /** When the free site crawl (lib/enrichment/site-enrich.ts) last ran for this row.
     *  Doubles as the atomic claim marker so two workers never crawl the same site —
     *  it is set by the same UPDATE ... RETURNING that selects the batch. */
    siteEnrichedAt: timestamp("site_enriched_at", { mode: "date" }),
    // Raw API response for future enrichment
    raw: jsonb("raw").default({}).notNull(),
    // Triage state
    status: extractionResultStatusEnum("status").notNull().default("pending"),
    promotedLeadId: text("promoted_lead_id").references(() => leads.id, {
      onDelete: "set null",
    }),
    // Timestamps
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("extraction_results_project_place_uq").on(t.projectId, t.placeId),
    index("extraction_results_triage_idx").on(t.projectId, t.status, desc(t.rating)),
    index("extraction_results_extraction_idx").on(t.extractionId),
  ],
);

export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  key: text("key").primaryKey(), // e.g. "auth:127.0.0.1"
  count: integer("count").notNull().default(0),
  resetAt: timestamp("reset_at", { mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

/** Caches CNPJ lookups (BrasilAPI et al.) for 30 days — see lib/enrichment/receita.ts.
 *  The upstream provider's rate limit is undocumented; this cache is what makes
 *  repeated "pesquisa profunda" runs across projects cheap and fast. */
export const cnpjCache = pgTable("cnpj_cache", {
  cnpj: text("cnpj").primaryKey(), // 14 digits, no punctuation
  payload: jsonb("payload").notNull(),
  provider: text("provider").notNull(), // e.g. "brasilapi"
  fetchedAt: timestamp("fetched_at", { mode: "date" }).defaultNow().notNull(),
});
