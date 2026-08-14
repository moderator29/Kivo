import "server-only";

/**
 * Whether Clerk has real keys in this environment. auth()/auth.protect()/currentUser()
 * all throw if clerkMiddleware() never ran for the request, which is the case whenever
 * these are unset — see src/proxy.ts. Resource-level guards check this first so an
 * unconfigured environment degrades to a redirect instead of a crash.
 */
export function isClerkConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}
