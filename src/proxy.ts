import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { REQUEST_PATH_HEADER, updateSupabaseSession } from "@/lib/supabase/proxy";

// This file is Next 16's Proxy (formerly middleware). Its ONE job is refreshing
// the Supabase Auth session cookie — it is deliberately not an authorization
// boundary.
//
// Why not gate routes here: matching on req.nextUrl.pathname can diverge from
// how Next.js actually resolves a request (rewrites, parallel/intercepting
// routes, trailing slashes, case-sensitivity), which could leave a route that
// *looks* covered by a matcher reachable unauthenticated. Next.js's own
// guidance agrees — Proxy is for optimistic, cookie-only checks, not the real
// security boundary (node_modules/next/dist/docs/01-app/02-guides/authentication.md,
// "Optimistic checks with Proxy").
//
// Real enforcement lives at the resource level: src/app/(app)/layout.tsx
// redirects to /sign-in when there is no session, src/app/admin/layout.tsx
// additionally checks role, and src/app/onboarding/page.tsx does its own check.
// Every one of those verifies the session against Supabase rather than trusting
// the cookie's contents.
//
// The refresh itself, however, can ONLY happen here: Server Components cannot
// write cookies, so without this a token that expires mid-session is never
// renewed and the user is silently signed out.
export default async function proxy(request: NextRequest) {
  // Without Supabase credentials configured there is no session to refresh and
  // createServerClient() throws on an empty URL, which would take down even the
  // public marketing pages. Fall through instead; the resource-level guards
  // still redirect to /sign-in because there is no session to find.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    // Still stamp the path (see REQUEST_PATH_HEADER): (app)/layout.tsx uses it
    // to build the sign-in return link, and this is precisely the environment
    // where every request ends up at the sign-in wall.
    request.headers.set(REQUEST_PATH_HEADER, request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.next({ request });
  }

  return updateSupabaseSession(request);
}

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
