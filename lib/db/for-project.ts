import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { projectMembers, users } from "@/db/schema";

/**
 * Verifies that a user has access to a project before returning the db client.
 *
 * Usage:
 *   const projectDb = await forProject(projectId, userId);
 *   const leads = await projectDb.query.leads.findMany({ ... });
 *
 * Throws a 403 error string if the user is not authorized.
 * Server Actions should catch this and return appropriate error responses.
 */
export async function forProject(
  projectId: string,
  userId: string,
): Promise<typeof db> {
  // Global owner bypasses project membership check
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { isOwner: true },
  });

  if (!user) {
    throw Object.assign(new Error("User not found"), { status: 401 });
  }

  if (!user.isOwner) {
    const membership = await db.query.projectMembers.findFirst({
      where: and(
        eq(projectMembers.userId, userId),
        eq(projectMembers.projectId, projectId),
      ),
      columns: { role: true },
    });

    if (!membership) {
      throw Object.assign(
        new Error("Access denied: not a member of this project"),
        { status: 403 },
      );
    }
  }

  // Return the same db instance — caller must always include project_id in WHERE clauses.
  // The wrapper ensures the authorization check ran before any query.
  return db;
}
