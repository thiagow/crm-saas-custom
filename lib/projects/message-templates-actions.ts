"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth, getIsOwner } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { forProject } from "@/lib/db/for-project";
import { requireRole } from "@/lib/auth/rbac";
import { projects, whatsappTemplates } from "@/db/schema";

async function resolveProject(projectSlug: string) {
  const project = await db.query.projects.findFirst({
    where: eq(projects.slug, projectSlug),
    columns: { id: true, slug: true },
  });
  if (!project) throw new Error("Project not found");
  return project;
}

export async function getMessageTemplates(projectSlug: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const project = await resolveProject(projectSlug);
  await forProject(project.id, session.user.id, getIsOwner(session));

  return db.query.whatsappTemplates.findMany({
    where: eq(whatsappTemplates.projectId, project.id),
    orderBy: [asc(whatsappTemplates.createdAt)],
    limit: 100,
  });
}

const createTemplateSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(1000),
});

export async function createMessageTemplate(input: z.infer<typeof createTemplateSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const data = createTemplateSchema.parse(input);
  await requireRole(session.user.id, data.projectId, "admin", getIsOwner(session));

  const [template] = await db
    .insert(whatsappTemplates)
    .values({
      projectId: data.projectId,
      title: data.title,
      body: data.body,
    })
    .returning();

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, data.projectId),
    columns: { slug: true },
  });
  if (project) revalidatePath(`/${project.slug}/settings`);

  return template!;
}

const updateTemplateSchema = z.object({
  id: z.string(),
  projectId: z.string().uuid(),
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(1000),
});

export async function updateMessageTemplate(input: z.infer<typeof updateTemplateSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const data = updateTemplateSchema.parse(input);
  await requireRole(session.user.id, data.projectId, "admin", getIsOwner(session));

  await db
    .update(whatsappTemplates)
    .set({ title: data.title, body: data.body, updatedAt: new Date() })
    .where(and(eq(whatsappTemplates.id, data.id), eq(whatsappTemplates.projectId, data.projectId)));

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, data.projectId),
    columns: { slug: true },
  });
  if (project) revalidatePath(`/${project.slug}/settings`);
}

const deleteTemplateSchema = z.object({
  id: z.string(),
  projectId: z.string().uuid(),
});

export async function deleteMessageTemplate(input: z.infer<typeof deleteTemplateSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const data = deleteTemplateSchema.parse(input);
  await requireRole(session.user.id, data.projectId, "admin", getIsOwner(session));

  await db
    .delete(whatsappTemplates)
    .where(and(eq(whatsappTemplates.id, data.id), eq(whatsappTemplates.projectId, data.projectId)));

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, data.projectId),
    columns: { slug: true },
  });
  if (project) revalidatePath(`/${project.slug}/settings`);
}
