"use server";

import { sessions } from "@/db/schema";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { and, eq, gt, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export async function getActiveSessions() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const now = new Date();
  return db.query.sessions.findMany({
    where: and(
      eq(sessions.userId, session.user.id),
      isNull(sessions.revokedAt),
      gt(sessions.expires, now),
    ),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });
}

const revokeSchema = z.object({ sessionToken: z.string().min(1) });

export async function revokeSession(input: z.infer<typeof revokeSchema>) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const { sessionToken } = revokeSchema.parse(input);

  // Verify the session belongs to the current user before revoking
  const target = await db.query.sessions.findFirst({
    where: and(eq(sessions.sessionToken, sessionToken), eq(sessions.userId, session.user.id)),
  });
  if (!target) throw new Error("Session not found");

  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.sessionToken, sessionToken));

  revalidatePath("/settings/security");
}

export async function revokeAllOtherSessions() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const now = new Date();

  // Revoke all non-expired, non-revoked sessions for this user
  // Note: with JWT strategy, this marks them in DB but doesn't immediately
  // invalidate existing JWTs. The tokens remain valid until expiry.
  // Full immediate revocation requires switching to database session strategy.
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(
      and(
        eq(sessions.userId, session.user.id),
        isNull(sessions.revokedAt),
        gt(sessions.expires, now),
      ),
    );

  revalidatePath("/settings/security");
}
