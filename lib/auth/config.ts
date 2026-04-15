import { accounts, authAuditLog, sessions, users, verificationTokens } from "@/db/schema";
import { db } from "@/lib/db/client";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
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
    verifyRequest: "/verify",
    error: "/login",
  },
  callbacks: {
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
      await db.insert(authAuditLog).values({
        userId: user.id,
        email: user.email,
        event: "login_success",
        // IP/userAgent not available in the event callback — captured at the route level if needed
      });
    },
  },
  trustHost: true,
};
