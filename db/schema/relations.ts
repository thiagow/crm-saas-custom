import { relations } from "drizzle-orm";
import { accounts, authAuditLog, sessions, users } from "./auth";
import { extractionResults, extractions } from "./extractions";
import { activities, leads } from "./leads";
import { pipelineStages } from "./pipeline";
import { projectMembers, projects } from "./projects";

// Auth relations
export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  projectMemberships: many(projectMembers),
  auditLogs: many(authAuditLog),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const authAuditLogRelations = relations(authAuditLog, ({ one }) => ({
  user: one(users, { fields: [authAuditLog.userId], references: [users.id] }),
}));

// Project relations
export const projectsRelations = relations(projects, ({ many }) => ({
  members: many(projectMembers),
  stages: many(pipelineStages),
  leads: many(leads),
  extractions: many(extractions),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, { fields: [projectMembers.projectId], references: [projects.id] }),
  user: one(users, { fields: [projectMembers.userId], references: [users.id] }),
}));

// Pipeline relations
export const pipelineStagesRelations = relations(pipelineStages, ({ one, many }) => ({
  project: one(projects, { fields: [pipelineStages.projectId], references: [projects.id] }),
  leads: many(leads),
}));

// Lead relations
export const leadsRelations = relations(leads, ({ one, many }) => ({
  project: one(projects, { fields: [leads.projectId], references: [projects.id] }),
  stage: one(pipelineStages, { fields: [leads.stageId], references: [pipelineStages.id] }),
  activities: many(activities),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
  lead: one(leads, { fields: [activities.leadId], references: [leads.id] }),
}));

// Extraction relations
export const extractionsRelations = relations(extractions, ({ one, many }) => ({
  project: one(projects, { fields: [extractions.projectId], references: [projects.id] }),
  results: many(extractionResults),
}));

export const extractionResultsRelations = relations(extractionResults, ({ one }) => ({
  extraction: one(extractions, {
    fields: [extractionResults.extractionId],
    references: [extractions.id],
  }),
  project: one(projects, {
    fields: [extractionResults.projectId],
    references: [projects.id],
  }),
  promotedLead: one(leads, {
    fields: [extractionResults.promotedLeadId],
    references: [leads.id],
  }),
}));
