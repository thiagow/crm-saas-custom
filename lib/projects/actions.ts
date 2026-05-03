"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth, getIsOwner } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { DEFAULT_STAGES_B2B, DEFAULT_STAGES_B2C, pipelineStages, projectMembers, projects } from "@/db/schema";
import { requireRole } from "@/lib/auth/rbac";
import { z } from "zod";

const createProjectSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, "Slug deve conter apenas letras minúsculas, números e hífens"),
  type: z.enum(["B2B", "B2C"]),
  description: z.string().max(300).optional(),
});

export async function createProject(input: z.infer<typeof createProjectSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const data = createProjectSchema.parse(input);
  const userId = session.user.id;

  const [project] = await db
    .insert(projects)
    .values({
      slug: data.slug,
      name: data.name,
      type: data.type,
      description: data.description,
    })
    .returning();

  if (!project) throw new Error("Failed to create project");

  // Add creator as owner member
  await db.insert(projectMembers).values({
    projectId: project.id,
    userId,
    role: "owner",
  });

  // Insert default stages based on project type
  const defaultStages = data.type === "B2B" ? DEFAULT_STAGES_B2B : DEFAULT_STAGES_B2C;
  await db.insert(pipelineStages).values(
    defaultStages.map((stage) => ({
      projectId: project.id,
      name: stage.name,
      order: stage.order,
      color: stage.color,
    })),
  );

  revalidatePath("/");
  return project;
}

export async function getProjects(userId?: string) {
  const session = await auth();
  const resolvedUserId = userId ?? session?.user?.id;
  if (!resolvedUserId) throw new Error("Unauthorized");

  if (getIsOwner(session)) {
    return db.query.projects.findMany({
      where: isNull(projects.archivedAt),
      orderBy: (p, { asc }) => [asc(p.name)],
    });
  }

  const memberships = await db.query.projectMembers.findMany({
    where: eq(projectMembers.userId, resolvedUserId),
    with: { project: true },
  });

  return memberships
    .map((m) => m.project)
    .filter((p) => !p.archivedAt)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function archiveProject(projectId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  await requireRole(session.user.id, projectId, "admin", getIsOwner(session));

  await db
    .update(projects)
    .set({ archivedAt: new Date() })
    .where(and(eq(projects.id, projectId), isNull(projects.archivedAt)));

  revalidatePath("/");
}
