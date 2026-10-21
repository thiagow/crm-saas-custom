import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe slice of the Auth.js config. Imported by middleware.ts, so it must never
 * pull in the database, the adapter or password hashing. Revocation checks
 * (isActive / sessionsValidAfter) live in config.ts and run on the Node runtime.
 */
export const authEdgeConfig = {
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  providers: [],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
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
  trustHost: true,
} satisfies NextAuthConfig;
