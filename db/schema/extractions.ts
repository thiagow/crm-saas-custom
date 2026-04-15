import {
  doublePrecision,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { leads } from "./leads";
import { projects } from "./projects";

export const extractionStatusEnum = pgEnum("extraction_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const extractionResultStatusEnum = pgEnum("extraction_result_status", [
  "pending",   // Waiting for user review in triage
  "promoted",  // Converted to a lead
  "discarded", // User discarded — stays in DB for audit
]);

export const extractions = pgTable("extractions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  // Search parameters
  query: text("query").notNull(),     // e.g. "academia de muay thai"
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
  // Timestamps
  startedAt: timestamp("started_at", { mode: "date" }),
  finishedAt: timestamp("finished_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

export const extractionResults = pgTable("extraction_results", {
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
  instagramSource: text("instagram_source"), // 'site_parse' | 'google_search' | null
  category: text("category"),
  rating: doublePrecision("rating"),
  reviewsCount: integer("reviews_count"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  photoUrl: text("photo_url"),
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
});

export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  key: text("key").primaryKey(),       // e.g. "auth:127.0.0.1"
  count: integer("count").notNull().default(0),
  resetAt: timestamp("reset_at", { mode: "date" }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});
