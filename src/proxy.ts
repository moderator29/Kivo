import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/home(.*)",
  "/social(.*)",
  "/live(.*)",
  "/matches(.*)",
  "/discover(.*)",
  "/fantasy(.*)",
  "/predictions(.*)",
  "/transfers(.*)",
  "/news(.*)",
  "/teams(.*)",
  "/players(.*)",
  "/leagues(.*)",
  "/ai(.*)",
  "/rewards(.*)",
  "/profile(.*)",
  "/admin(.*)",
  "/onboarding(.*)",
]);

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);

const withClerk = clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

// Without Clerk keys configured, clerkMiddleware() throws on every request —
// including the public marketing page, which needs no auth at all. Falling
// through to a no-op keeps the app viewable (auth-gated routes simply have
// no protection until real keys exist, same as any other unconfigured
// optional integration in this codebase).
export default clerkConfigured
  ? withClerk
  : function proxy(req: NextRequest) {
      if (isProtectedRoute(req)) {
        return NextResponse.redirect(new URL("/sign-in", req.url));
      }
      return NextResponse.next();
    };

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
