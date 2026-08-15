import { NextResponse } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { isClerkConfigured } from "@/lib/clerk";

// `createRouteMatcher` + `auth.protect()` here is deprecated by Clerk: matching on
// req.nextUrl.pathname can diverge from how Next.js actually resolves a request
// (rewrites, parallel/intercepting routes, trailing slashes, case-sensitivity), which
// could leave a route that *looks* covered by the matcher reachable unauthenticated.
// Next.js's own guidance agrees — Proxy/middleware is for optimistic, cookie-only
// checks, not the real security boundary (node_modules/next/dist/docs/01-app/02-guides/authentication.md,
// "Optimistic checks with Proxy").
//
// Real enforcement now lives at the resource level: every protected layout/page calls
// `auth.protect()` itself (src/app/(app)/layout.tsx, src/app/admin/layout.tsx,
// src/app/onboarding/page.tsx). clerkMiddleware() is still run here — without it,
// auth()/auth.protect() have no request-scoped auth context to read and throw when
// called downstream — so this file keeps that one job and nothing else.
const withClerk = clerkMiddleware();

// Without Clerk keys configured, clerkMiddleware() throws on every request —
// including the public marketing page, which needs no auth at all. Falling through to
// a no-op keeps the app viewable; protected routes still redirect to /sign-in on their
// own via isClerkConfigured() in the resource-level guards, since there's no session to
// check when Clerk has no keys.
export default isClerkConfigured()
  ? withClerk
  : function proxy() {
      return NextResponse.next();
    };

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
