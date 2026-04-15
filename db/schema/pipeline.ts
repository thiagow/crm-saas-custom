import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { projects } from "./projects";

export const pipelineStages = pgTable("pipeline_stages", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  order: integer("order").notNull(),
  color: text("color").notNull().default("#6366f1"), // hex color for the column header
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

/**
 * Default stages inserted when a project is created.
 * Kept in code (not DB) to avoid a config table — simple and explicit.
 */
export const DEFAULT_STAGES_B2B = [
  { name: "Novo", order: 0, color: "#6366f1" },
  { name: "Contato Feito", order: 1, color: "#8b5cf6" },
  { name: "Qualificado", order: 2, color: "#3b82f6" },
  { name: "Proposta", order: 3, color: "#f59e0b" },
  { name: "Negociação", order: 4, color: "#f97316" },
  { name: "Ganho", order: 5, color: "#22c55e" },
  { name: "Perdido", order: 6, color: "#ef4444" },
] as const;

export const DEFAULT_STAGES_B2C = [
  { name: "Novo", order: 0, color: "#6366f1" },
  { name: "Engajado", order: 1, color: "#8b5cf6" },
  { name: "Interessado", order: 2, color: "#3b82f6" },
  { name: "Conversão", order: 3, color: "#f59e0b" },
  { name: "Ganho", order: 4, color: "#22c55e" },
  { name: "Perdido", order: 5, color: "#ef4444" },
] as const;
