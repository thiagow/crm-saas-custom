import { auth } from "@/lib/auth";
import type { NextAuthRequest } from "next-auth";
import { NextResponse } from "next/server";

/**
 * Route protection middleware using Auth.js v5.
 * - /login and /verify are public.
 * - /api/auth/* is handled by Auth.js itself.
 * - Everything else requires an authenticated session.
 */
export default auth((req: NextAuthRequest) => {
  const { pathname } = req.nextUrl;
  const isAuthenticated = !!req.auth?.user;

  const isPublic =
    pathname === "/login" ||
    pathname === "/verify" ||
    pathname === "/api/health" ||
    pathname.startsWith("/api/auth");

  if (!isPublic && !isAuthenticated) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthenticated && pathname === "/login") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
