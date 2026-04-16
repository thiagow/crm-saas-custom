import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { projectRoleEnum } from "./projects";
import { users } from "./auth";
import { projects } from "./projects";

export const invites = pgTable("invites", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull(),
  // Which project to add them to on acceptance (null = system-level access only)
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  role: projectRoleEnum("role").notNull().default("sales"),
  invitedById: text("invited_by_id").references(() => users.id, { onDelete: "set null" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  acceptedAt: timestamp("accepted_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});
