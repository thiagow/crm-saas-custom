import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { projectMembers } from "@/db/schema";

/**
 * Verifies that a user has access to a project before returning the db client.
 * Pass isOwner=true (from session JWT) to bypass DB checks entirely for global owners.
 */
export async function forProject(
  projectId: string,
  userId: string,
  isOwner?: boolean,
): Promise<typeof db> {
  if (isOwner) return db;

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

  return db;
}
