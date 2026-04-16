"use server";

import { projectMembers, projects, users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { requireRole } from "@/lib/auth/rbac";
import { db } from "@/lib/db/client";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

async function getProjectSlug(projectId: string) {
  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    columns: { slug: true },
  });
  return project?.slug;
}

// ─── Add member ───────────────────────────────────────────────────────────────

const addMemberSchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().min(1),
  role: z.enum(["owner", "admin", "sales", "viewer"]).default("sales"),
});

export async function addProjectMember(input: z.infer<typeof addMemberSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const data = addMemberSchema.parse(input);
  await requireRole(session.user.id, data.projectId, "admin");

  // Verify target user exists and is active
  const user = await db.query.users.findFirst({
    where: eq(users.id, data.userId),
    columns: { isActive: true },
  });
  if (!user) throw new Error("Usuário não encontrado");
  if (!user.isActive) throw new Error("Usuário está desativado");

  const existing = await db.query.projectMembers.findFirst({
    where: and(
      eq(projectMembers.userId, data.userId),
      eq(projectMembers.projectId, data.projectId),
    ),
  });
  if (existing) throw new Error("Usuário já é membro deste projeto");

  await db.insert(projectMembers).values({
    projectId: data.projectId,
    userId: data.userId,
    role: data.role,
  });

  const slug = await getProjectSlug(data.projectId);
  if (slug) revalidatePath(`/${slug}/settings`);
}

// ─── Remove member ────────────────────────────────────────────────────────────

const removeMemberSchema = z.object({
  memberId: z.string().min(1),
  projectId: z.string().uuid(),
});

export async function removeProjectMember(input: z.infer<typeof removeMemberSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const data = removeMemberSchema.parse(input);
  await requireRole(session.user.id, data.projectId, "admin");

  // Don't allow removing yourself
  const membership = await db.query.projectMembers.findFirst({
    where: and(
      eq(projectMembers.id, data.memberId),
      eq(projectMembers.projectId, data.projectId),
    ),
    columns: { userId: true },
  });
  if (membership?.userId === session.user.id) {
    throw new Error("Você não pode se remover do projeto.");
  }

  await db
    .delete(projectMembers)
    .where(
      and(
        eq(projectMembers.id, data.memberId),
        eq(projectMembers.projectId, data.projectId),
      ),
    );

  const slug = await getProjectSlug(data.projectId);
  if (slug) revalidatePath(`/${slug}/settings`);
}

// ─── Update member role ───────────────────────────────────────────────────────

const updateRoleSchema = z.object({
  memberId: z.string().min(1),
  projectId: z.string().uuid(),
  role: z.enum(["owner", "admin", "sales", "viewer"]),
});

export async function updateMemberRole(input: z.infer<typeof updateRoleSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const data = updateRoleSchema.parse(input);
  await requireRole(session.user.id, data.projectId, "admin");

  await db
    .update(projectMembers)
    .set({ role: data.role })
    .where(
      and(
        eq(projectMembers.id, data.memberId),
        eq(projectMembers.projectId, data.projectId),
      ),
    );

  const slug = await getProjectSlug(data.projectId);
  if (slug) revalidatePath(`/${slug}/settings`);
}
