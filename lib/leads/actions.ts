"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth, getIsOwner } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { forProject } from "@/lib/db/for-project";
import { activities, leads, pipelineStages, projects } from "@/db/schema";
import { requireRole } from "@/lib/auth/rbac";
import { z } from "zod";

export async function getKanbanData(projectSlug: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  // Resolve slug → id and authorize
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.slug, projectSlug)),
    columns: { id: true, name: true, type: true },
  });
  if (!project) throw new Error("Project not found");

  await forProject(project.id, session.user.id, getIsOwner(session));

  const [stages, allLeads] = await Promise.all([
    db.query.pipelineStages.findMany({
      where: eq(pipelineStages.projectId, project.id),
      orderBy: [asc(pipelineStages.order)],
    }),
    db.query.leads.findMany({
      where: eq(leads.projectId, project.id),
      orderBy: [asc(leads.createdAt)],
      with: {
        activities: {
          orderBy: [asc(activities.occurredAt)],
          limit: 1,
        },
      },
    }),
  ]);

  return { project, stages, leads: allLeads };
}

const moveLeadSchema = z.object({
  leadId: z.string(),
  stageId: z.string(),
  projectSlug: z.string(),
});

export async function moveLead(input: z.infer<typeof moveLeadSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const { leadId, stageId, projectSlug } = moveLeadSchema.parse(input);

  // Resolve slug → id and authorize
  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, projectSlug),
    columns: { id: true },
  });
  if (!project) throw new Error("Project not found");

  await requireRole(session.user.id, project.id, "sales", getIsOwner(session));

  // Get old stage for activity log
  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, leadId), eq(leads.projectId, project.id)),
    with: { stage: { columns: { name: true } } },
  });
  if (!lead) throw new Error("Lead not found");

  const newStage = await db.query.pipelineStages.findFirst({
    where: and(eq(pipelineStages.id, stageId), eq(pipelineStages.projectId, project.id)),
    columns: { name: true },
  });
  if (!newStage) throw new Error("Stage not found");

  await db
    .update(leads)
    .set({ stageId, updatedAt: new Date() })
    .where(and(eq(leads.id, leadId), eq(leads.projectId, project.id)));

  // Log the stage change activity
  await db.insert(activities).values({
    leadId,
    type: "stage_change",
    content: `Movido de "${lead.stage.name}" para "${newStage.name}"`,
    metadata: { from_stage: lead.stage.name, to_stage: newStage.name },
  });

  revalidatePath(`/${projectSlug}/kanban`);
}

const addActivitySchema = z.object({
  leadId: z.string(),
  projectSlug: z.string(),
  type: z.enum(["note", "call", "email", "whatsapp", "instagram_dm", "meeting"]),
  content: z.string().min(1).max(2000),
});

export async function addActivity(input: z.infer<typeof addActivitySchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const data = addActivitySchema.parse(input);

  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, data.projectSlug),
    columns: { id: true },
  });
  if (!project) throw new Error("Project not found");

  await requireRole(session.user.id, project.id, "sales", getIsOwner(session));

  // Verify lead belongs to project
  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, data.leadId), eq(leads.projectId, project.id)),
    columns: { id: true },
  });
  if (!lead) throw new Error("Lead not found");

  await db.insert(activities).values({
    leadId: data.leadId,
    type: data.type,
    content: data.content,
    metadata: {},
  });

  revalidatePath(`/${data.projectSlug}/kanban`);
}

export async function getLeadDetails(leadId: string, projectSlug: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, projectSlug),
    columns: { id: true },
  });
  if (!project) throw new Error("Project not found");

  await forProject(project.id, session.user.id, getIsOwner(session));

  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, leadId), eq(leads.projectId, project.id)),
    with: {
      stage: true,
      activities: {
        orderBy: [asc(activities.occurredAt)],
      },
    },
  });

  if (!lead) throw new Error("Lead not found");
  return lead;
}

const createLeadSchema = z.object({
  projectSlug: z.string(),
  stageId: z.string(),
  name: z.string().min(1).max(200),
  company: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  email: z.string().email().optional().or(z.literal("")),
  website: z.string().url().optional().or(z.literal("")),
  instagramHandle: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  value: z.number().positive().optional(),
});

const updateLeadSchema = z.object({
  leadId: z.string(),
  projectSlug: z.string(),
  stageId: z.string(),
  name: z.string().min(1).max(200),
  company: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  email: z.string().email().optional().or(z.literal("")),
  website: z.string().url().optional().or(z.literal("")),
  instagramHandle: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  value: z.number().positive().optional(),
});

export async function createLead(input: z.infer<typeof createLeadSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const data = createLeadSchema.parse(input);

  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, data.projectSlug),
    columns: { id: true },
  });
  if (!project) throw new Error("Project not found");

  await requireRole(session.user.id, project.id, "sales", getIsOwner(session));

  // Validate stage exists in project
  const stage = await db.query.pipelineStages.findFirst({
    where: and(eq(pipelineStages.id, data.stageId), eq(pipelineStages.projectId, project.id)),
    columns: { id: true },
  });
  if (!stage) throw new Error("Stage not found");

  const [lead] = await db
    .insert(leads)
    .values({
      projectId: project.id,
      stageId: data.stageId,
      name: data.name,
      company: data.company,
      phone: data.phone,
      email: data.email,
      website: data.website,
      instagramHandle: data.instagramHandle,
      city: data.city,
      state: data.state,
      source: "manual" as const,
      value: data.value,
      tags: [],
      customFields: {},
    })
    .returning();

  if (!lead) throw new Error("Failed to create lead");

  revalidatePath(`/${data.projectSlug}/kanban`);
  revalidatePath(`/${data.projectSlug}/leads`);

  return lead;
}

export async function updateLead(input: z.infer<typeof updateLeadSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const data = updateLeadSchema.parse(input);

  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, data.projectSlug),
    columns: { id: true },
  });
  if (!project) throw new Error("Project not found");

  await requireRole(session.user.id, project.id, "sales", getIsOwner(session));

  // Verify lead exists and belongs to project
  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, data.leadId), eq(leads.projectId, project.id)),
    columns: { id: true },
  });
  if (!lead) throw new Error("Lead not found");

  // Validate stage exists in project
  const stage = await db.query.pipelineStages.findFirst({
    where: and(eq(pipelineStages.id, data.stageId), eq(pipelineStages.projectId, project.id)),
    columns: { id: true },
  });
  if (!stage) throw new Error("Stage not found");

  await db
    .update(leads)
    .set({
      name: data.name,
      company: data.company,
      phone: data.phone,
      email: data.email,
      website: data.website,
      instagramHandle: data.instagramHandle,
      city: data.city,
      state: data.state,
      stageId: data.stageId,
      value: data.value,
      updatedAt: new Date(),
    })
    .where(eq(leads.id, data.leadId));

  revalidatePath(`/${data.projectSlug}/kanban`);
  revalidatePath(`/${data.projectSlug}/leads`);
}

const deleteLeadSchema = z.object({
  leadId: z.string(),
  projectSlug: z.string(),
});

export async function deleteLead(input: z.infer<typeof deleteLeadSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const data = deleteLeadSchema.parse(input);

  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, data.projectSlug),
    columns: { id: true },
  });
  if (!project) throw new Error("Project not found");

  await requireRole(session.user.id, project.id, "sales", getIsOwner(session));

  // Verify lead exists and belongs to project
  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, data.leadId), eq(leads.projectId, project.id)),
    with: { stage: { columns: { name: true } } },
  });
  if (!lead) throw new Error("Lead not found");

  // Only allow deletion if lead is in "Novo" stage
  if (lead.stage.name !== "Novo") {
    throw new Error("Lead pode ser excluído apenas no estágio Novo");
  }

  await db.delete(leads).where(eq(leads.id, data.leadId));

  revalidatePath(`/${data.projectSlug}/kanban`);
  revalidatePath(`/${data.projectSlug}/leads`);
}
