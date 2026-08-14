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
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
