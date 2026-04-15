import { pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth";

export const projectTypeEnum = pgEnum("project_type", ["B2B", "B2C"]);
export const projectRoleEnum = pgEnum("project_role", ["owner", "admin", "sales", "viewer"]);

export const projects = pgTable("projects", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  slug: text("slug").unique().notNull(), // URL-friendly identifier, e.g. "academias-luta"
  name: text("name").notNull(),
  type: projectTypeEnum("type").notNull().default("B2B"),
  description: text("description"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  archivedAt: timestamp("archived_at", { mode: "date" }),
});

export const projectMembers = pgTable("project_members", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: projectRoleEnum("role").notNull().default("sales"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});
