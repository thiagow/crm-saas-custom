import {
  doublePrecision,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { pipelineStages } from "./pipeline";
import { projects } from "./projects";

export const leadSourceEnum = pgEnum("lead_source", [
  "google_maps",
  "csv_import",
  "manual",
]);

export const activityTypeEnum = pgEnum("activity_type", [
  "note",
  "call",
  "email",
  "whatsapp",
  "instagram_dm",
  "meeting",
  "stage_change",
]);

export const leads = pgTable("leads", {
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
  email: text("email"),
  website: text("website"),
  instagramHandle: text("instagram_handle"),
  // Location
  city: text("city"),
  state: text("state"),
  // Meta
  source: leadSourceEnum("source").notNull().default("manual"),
  value: doublePrecision("value"), // estimated deal value in BRL
  tags: text("tags").array().default([]).notNull(),
  customFields: jsonb("custom_fields").default({}).notNull(),
  // Google Places reference (if sourced from extraction)
  placeId: text("place_id"),
  // Timestamps
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

export const activities = pgTable("activities", {
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
});
