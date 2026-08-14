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

/**
 * Validate a `redirect_url` search-param value before it's ever forwarded to
 * Clerk's forceRedirectUrl. That value comes straight from the URL a guest
 * followed (e.g. `/sign-up?redirect_url=...`), which an attacker can craft
 * freely — accepting anything other than a same-origin, root-relative path
 * here would turn "return to the page you were on" into an open redirect
 * (a full URL, a protocol-relative "//host" URL, or a backslash-prefixed
 * path some browsers normalize into "//host" could all send a freshly
 * signed-up user straight off the site).
 */
export function sanitizeRedirectPath(value: string | string[] | undefined): string | undefined {
  const path = Array.isArray(value) ? value[0] : value;
  if (!path || !/^\/(?!\/|\\)/.test(path)) return undefined;
  return path;
}
