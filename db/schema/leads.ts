import { desc, sql } from "drizzle-orm";
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
import { pipelineStages } from "./pipeline";
import { projects } from "./projects";

export const leadSourceEnum = pgEnum("lead_source", ["google_maps", "csv_import", "manual"]);

// Re-declared locally (same PG enum name + values as db/schema/extractions.ts) rather
// than imported from there — extractions.ts already imports `leads` for its
// promoted_lead_id FK, so importing the other way would create a circular dependency
// between the two schema files. Drizzle only cares that the name/values match when
// generating SQL; both declarations point at the same underlying Postgres type.
const phoneTypeEnum = pgEnum("phone_type", ["mobile", "landline", "tollfree", "unknown"]);
const whatsappStatusEnum = pgEnum("whatsapp_status", ["unknown", "likely", "verified", "none"]);

export const activityTypeEnum = pgEnum("activity_type", [
  "note",
  "call",
  "email",
  "whatsapp",
  "instagram_dm",
  "meeting",
  "stage_change",
]);

export const leads = pgTable(
  "leads",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    stageId: text("stage_id")
      .notNull()
      .references(() => pipelineStages.id),
    // Identity
    name: text("name").notNull(),
    company: text("company"),
    // Contact
    phone: text("phone"),
    whatsapp: text("whatsapp"), // E.164, may differ from `phone` (e.g. wa.me link found on site)
    phoneType: phoneTypeEnum("phone_type").notNull().default("unknown"),
    whatsappStatus: whatsappStatusEnum("whatsapp_status").notNull().default("unknown"),
    email: text("email"),
    website: text("website"),
    instagramHandle: text("instagram_handle"),
    instagramFollowers: integer("instagram_followers"),
    // Location
    city: text("city"),
    state: text("state"),
    address: text("address"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    // Google Maps presence (carried over from extraction — see lib/extractions/promote.ts)
    category: text("category"),
    rating: doublePrecision("rating"),
    reviewsCount: integer("reviews_count"),
    isOnGoogleMaps: boolean("is_on_google_maps").notNull().default(false),
    googleMapsUrl: text("google_maps_url"),
    // Owner / company (from CNPJ "pesquisa profunda", if it ran before promotion)
    ownerName: text("owner_name"),
    ownerEmail: text("owner_email"),
    cnpj: text("cnpj"),
    legalName: text("legal_name"),
    // Meta
    source: leadSourceEnum("source").notNull().default("manual"),
    value: doublePrecision("value"), // estimated deal value in BRL
    tags: text("tags").array().default([]).notNull(),
    customFields: jsonb("custom_fields").default({}).notNull(),
    // Google Places reference (if sourced from extraction). No FK to extraction_results
    // here — extractions.ts already references leads.id (promoted_lead_id), and adding
    // the opposite-direction FK would create a circular import between the two schema files.
    placeId: text("place_id"),
    sourceResultId: text("source_result_id"),
    // Timestamps
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [
    index("leads_project_stage_idx").on(t.projectId, t.stageId),
    index("leads_project_created_idx").on(t.projectId, desc(t.createdAt)),
    uniqueIndex("leads_project_place_uq")
      .on(t.projectId, t.placeId)
      .where(sql`${t.placeId} is not null`),
  ],
);

export const activities = pgTable(
  "activities",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    type: activityTypeEnum("type").notNull(),
    content: text("content"),
    metadata: jsonb("metadata").default({}).notNull(), // e.g. { from_stage: '...', to_stage: '...' }
    occurredAt: timestamp("occurred_at", { mode: "date" }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (t) => [index("activities_lead_occurred_idx").on(t.leadId, desc(t.occurredAt))],
);
