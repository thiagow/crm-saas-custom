"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { projects } from "@/db/schema";
import { requireRole } from "@/lib/auth/rbac";
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

  await requireRole(session.user.id, data.projectId, "admin");

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
