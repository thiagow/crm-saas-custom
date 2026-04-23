import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projectMembers } from "@/db/schema";

export type ProjectRole = "owner" | "admin" | "sales" | "viewer";

const ROLE_HIERARCHY: Record<ProjectRole, number> = {
  owner: 4,
  admin: 3,
  sales: 2,
  viewer: 1,
};

/**
 * Check if a user has at least the required role in a project.
 * Pass isOwner=true (from session JWT) to bypass DB checks entirely for global owners.
 */
export async function hasProjectRole(
  userId: string,
  projectId: string,
  minRole: ProjectRole,
  isOwner?: boolean,
): Promise<boolean> {
  if (isOwner) return true;

  const membership = await db.query.projectMembers.findFirst({
    where: and(
      eq(projectMembers.userId, userId),
      eq(projectMembers.projectId, projectId),
    ),
    columns: { role: true },
  });

  if (!membership) return false;

  return ROLE_HIERARCHY[membership.role] >= ROLE_HIERARCHY[minRole];
}

/**
 * Assert that a user has at least the required role. Throws if not authorized.
 * Pass isOwner=true (from session JWT) to bypass DB checks entirely for global owners.
 */
export async function requireRole(
  userId: string,
  projectId: string,
  minRole: ProjectRole,
  isOwner?: boolean,
): Promise<void> {
  const authorized = await hasProjectRole(userId, projectId, minRole, isOwner);
  if (!authorized) {
    throw new Error("Unauthorized: insufficient role for this project");
  }
}
