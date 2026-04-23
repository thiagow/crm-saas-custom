import NextAuth from "next-auth";
import { authConfig } from "./config";

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

type SessionLike = { user?: unknown } | null;

export function getIsOwner(session: SessionLike): boolean {
  return (session?.user as { isOwner?: boolean } | undefined)?.isOwner === true;
}
