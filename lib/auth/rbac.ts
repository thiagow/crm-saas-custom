import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projectMembers, users } from "@/db/schema";

export type ProjectRole = "owner" | "admin" | "sales" | "viewer";

const ROLE_HIERARCHY: Record<ProjectRole, number> = {
  owner: 4,
  admin: 3,
  sales: 2,
  viewer: 1,
};

/**
 * Check if a user has at least the required role in a project.
 * Global owners bypass all project-level checks.
 */
export async function hasProjectRole(
  userId: string,
  projectId: string,
  minRole: ProjectRole,
): Promise<boolean> {
  // Global owner bypasses all checks
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { isOwner: true },
  });

  if (user?.isOwner) return true;

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
 * Use in Server Actions and Route Handlers.
 */
export async function requireRole(
  userId: string,
  projectId: string,
  minRole: ProjectRole,
): Promise<void> {
  const authorized = await hasProjectRole(userId, projectId, minRole);
  if (!authorized) {
    throw new Error("Unauthorized: insufficient role for this project");
  }
}
