"use server";

import { leads, pipelineStages, projects } from "@/db/schema";
import { auth, getIsOwner } from "@/lib/auth";
import { requireRole } from "@/lib/auth/rbac";
import { db } from "@/lib/db/client";
import { and, count, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const updateProjectSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
});

export async function updateProjectSettings(input: z.infer<typeof updateProjectSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const data = updateProjectSchema.parse(input);

  await requireRole(session.user.id, data.projectId, "admin", getIsOwner(session));

  const [updated] = await db
    .update(projects)
    .set({
      name: data.name,
      description: data.description,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, data.projectId))
    .returning({ slug: projects.slug });

  if (!updated) throw new Error("Project not found");

  revalidatePath(`/${updated.slug}/settings`);
  revalidatePath("/");
}

// ─── Pipeline stage CRUD ────────────────────────────────────────────────────

const stageColorRegex = /^#[0-9a-fA-F]{6}$/;

const addStageSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(60),
  color: z.string().regex(stageColorRegex, "Cor inválida (use hex #rrggbb)"),
});

export async function addPipelineStage(input: z.infer<typeof addStageSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const data = addStageSchema.parse(input);
  await requireRole(session.user.id, data.projectId, "admin", getIsOwner(session));

  const existing = await db.query.pipelineStages.findMany({
    where: eq(pipelineStages.projectId, data.projectId),
    columns: { order: true },
  });
  const nextOrder = existing.length > 0 ? Math.max(...existing.map((s) => s.order)) + 1 : 0;

  const [newStage] = await db
    .insert(pipelineStages)
    .values({
      projectId: data.projectId,
      name: data.name,
      color: data.color,
      order: nextOrder,
    })
    .returning();

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, data.projectId),
    columns: { slug: true },
  });
  if (project) revalidatePath(`/${project.slug}/settings`);

  return {
    id: newStage!.id,
    name: newStage!.name,
    color: newStage!.color,
    order: newStage!.order,
  };
}

const updateStageSchema = z.object({
  stageId: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string().min(1).max(60),
  color: z.string().regex(stageColorRegex, "Cor inválida (use hex #rrggbb)"),
});

export async function updatePipelineStage(input: z.infer<typeof updateStageSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const data = updateStageSchema.parse(input);
  await requireRole(session.user.id, data.projectId, "admin", getIsOwner(session));

  await db
    .update(pipelineStages)
    .set({ name: data.name, color: data.color })
    .where(and(eq(pipelineStages.id, data.stageId), eq(pipelineStages.projectId, data.projectId)));

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, data.projectId),
    columns: { slug: true },
  });
  if (project) revalidatePath(`/${project.slug}/settings`);
}

const deleteStageSchema = z.object({
  stageId: z.string().uuid(),
  projectId: z.string().uuid(),
});

export async function deletePipelineStage(input: z.infer<typeof deleteStageSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const data = deleteStageSchema.parse(input);
  await requireRole(session.user.id, data.projectId, "admin", getIsOwner(session));

  const [leadsInStage] = await db
    .select({ total: count() })
    .from(leads)
    .where(eq(leads.stageId, data.stageId));

  if ((leadsInStage?.total ?? 0) > 0) {
    throw new Error(`Mova os ${leadsInStage?.total} leads deste estágio antes de deletá-lo.`);
  }

  await db
    .delete(pipelineStages)
    .where(and(eq(pipelineStages.id, data.stageId), eq(pipelineStages.projectId, data.projectId)));

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, data.projectId),
    columns: { slug: true },
  });
  if (project) revalidatePath(`/${project.slug}/settings`);
}

const reorderStagesSchema = z.object({
  projectId: z.string().uuid(),
  orderedIds: z.array(z.string().uuid()).min(1),
});

export async function reorderPipelineStages(input: z.infer<typeof reorderStagesSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const data = reorderStagesSchema.parse(input);
  await requireRole(session.user.id, data.projectId, "admin", getIsOwner(session));

  // Batch update orders using a CASE expression
  await db.execute(
    sql`UPDATE pipeline_stages
        SET "order" = CASE id
          ${sql.join(
            data.orderedIds.map((id, idx) => sql`WHEN ${id} THEN ${idx}`),
            sql` `,
          )}
        END
        WHERE project_id = ${data.projectId}
          AND id = ANY(${sql`ARRAY[${sql.join(
            data.orderedIds.map((id) => sql`${id}::text`),
            sql`, `,
          )}]`})`,
  );

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, data.projectId),
    columns: { slug: true },
  });
  if (project) revalidatePath(`/${project.slug}/settings`);
}
