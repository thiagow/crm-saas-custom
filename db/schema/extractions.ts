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
    costUsd: doublePrecision("cost_usd").default(0).notNull(),
    errorMessage: text("error_message"),
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
