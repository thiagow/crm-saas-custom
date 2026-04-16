import { accounts, authAuditLog, invites, projectMembers, sessions, users, verificationTokens } from "@/db/schema";
import { db } from "@/lib/db/client";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { NextAuthConfig } from "next-auth";
import Resend from "next-auth/providers/resend";

if (!process.env.RESEND_API_KEY) {
  throw new Error("RESEND_API_KEY environment variable is required");
}

if (!process.env.RESEND_FROM_EMAIL) {
  throw new Error("RESEND_FROM_EMAIL environment variable is required");
}

export const authConfig: NextAuthConfig = {
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.RESEND_FROM_EMAIL,
      name: "Email",
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;

      // Owner bypass
      if (process.env.OWNER_EMAIL && user.email === process.env.OWNER_EMAIL) {
        return true;
      }

      const now = new Date();

      // 1. User already exists in the system → check isActive
      const existingUser = await db.query.users.findFirst({
        where: eq(users.email, user.email),
        columns: { isActive: true },
      });
      if (existingUser) return existingUser.isActive;

      // 2. No existing user → must have a valid, non-expired invite
      const invite = await db.query.invites.findFirst({
        where: and(
          eq(invites.email, user.email),
          isNull(invites.acceptedAt),
          gt(invites.expiresAt, now),
        ),
        columns: { id: true },
      });

      return !!invite;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.isOwner = (user as typeof user & { isOwner?: boolean }).isOwner ?? false;
      }
      return token;
    },
    session({ session, token }) {
      if (token.id) {
        session.user.id = token.id as string;
      }
      if (typeof token.isOwner === "boolean") {
        (session.user as typeof session.user & { isOwner: boolean }).isOwner = token.isOwner;
      }
      return session;
    },
  },
  events: {
    async signIn({ user }) {
      if (!user.id || !user.email) return;

      const now = new Date();

      // Auto-set isOwner flag for the designated owner email
      if (process.env.OWNER_EMAIL && user.email === process.env.OWNER_EMAIL) {
        await db.update(users).set({ isOwner: true }).where(eq(users.id, user.id));
      }

      // Accept any pending invite for this user and add them to the project
      const invite = await db.query.invites.findFirst({
        where: and(
          eq(invites.email, user.email),
          isNull(invites.acceptedAt),
          gt(invites.expiresAt, now),
        ),
        columns: { id: true, projectId: true, role: true },
      });

      if (invite) {
        await db
          .update(invites)
          .set({ acceptedAt: now })
          .where(eq(invites.id, invite.id));

        if (invite.projectId) {
          const alreadyMember = await db.query.projectMembers.findFirst({
            where: and(
              eq(projectMembers.userId, user.id),
              eq(projectMembers.projectId, invite.projectId),
            ),
            columns: { id: true },
          });
          if (!alreadyMember) {
            await db.insert(projectMembers).values({
              userId: user.id,
              projectId: invite.projectId,
              role: invite.role,
            });
          }
        }
      }

      await db.insert(authAuditLog).values({
        userId: user.id,
        email: user.email,
        event: "login_success",
      });
    },
  },
  trustHost: true,
};
