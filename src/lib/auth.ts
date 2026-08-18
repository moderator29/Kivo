import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { createServerSupabaseClient } from "./supabase/server";
import { REQUEST_PATH_HEADER } from "./supabase/proxy";

/**
 * The signed-in Supabase Auth user, reduced to what KIVO actually needs.
 * `id` is auth.users.id — the uuid every RLS policy resolves the caller
 * through (profiles.auth_user_id, see migration 0053).
 */
export type AuthUser = {
  id: string;
  email: string | null;
};

/**
 * Whether Supabase Auth has real credentials in this environment. Both keys are
 * required: without them `createServerClient()` cannot be constructed at all,
 * so guards check this first and degrade to "signed out" instead of throwing.
 */
export function isAuthConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * Verified identity of the current request, or null when signed out.
 *
 * Uses `getClaims()` rather than `getSession()`: the session cookie is sent by
 * the browser and can be forged, whereas `getClaims()` validates the JWT's
 * signature against the project's published JWKS before returning anything.
 * This is the only thing any server-side authorization check in KIVO is allowed
 * to trust.
 *
 * `cache()`d for the same reason `getOrCreateProfile()` is: a single request
 * asks "who is this?" from the layout, the page, and often an action too.
 * Memoization is per-request only.
 */
export const getAuthUser = cache(async (): Promise<AuthUser | null> => {
  if (!isAuthConfigured()) return null;

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;

  return {
    id: data.claims.sub,
    email: typeof data.claims.email === "string" ? data.claims.email : null,
  };
});

/**
 * Validate a `redirect_url` search-param value before it's ever used as a
 * post-sign-in destination. That value comes straight from the URL a guest
 * followed (e.g. `/sign-up?redirect_url=...`), which an attacker can craft
 * freely — accepting anything other than a same-origin, root-relative path
 * here would turn "return to the page you were on" into an open redirect
 * (a full URL, a protocol-relative "//host" URL, or a backslash-prefixed
 * path some browsers normalize into "//host" could all send a freshly
 * signed-up user straight off the site).
 *
 * Moved here from the deleted src/lib/clerk.ts when auth swapped to Supabase —
 * the protection is provider-independent and must outlive the provider.
 */
export function sanitizeRedirectPath(value: string | string[] | undefined | null): string | undefined {
  const path = Array.isArray(value) ? value[0] : value;
  if (!path || !/^\/(?!\/|\\)/.test(path)) return undefined;
  return path;
}

/**
 * Where to send a visitor who hit a gated route without a session, with the
 * route they were actually trying to open attached.
 *
 * KN-123. Gating the entire product turned a missing `redirect_url` from a
 * papercut into a broken growth loop: a shared match link, a notification deep
 * link, an emailed URL and a bookmark all used to dump the user on `/home`
 * after signing in, never on the thing they opened. Every piece needed to fix
 * it already existed (`sanitizeRedirectPath`, `redirect_url` on both auth
 * pages, `verifyEmailCode`'s server-side re-validation) — the gate simply
 * never passed the path along, because a Server Component cannot read its own
 * URL. `src/proxy.ts` stamps it on the request instead.
 *
 * `/home` is deliberately not carried: it is already the post-sign-in default,
 * so attaching it would only make the URL noisier. The value is sanitized here
 * even though Proxy overwrites the header on every matched request, because
 * "unreachable today" is not the same as "safe by construction".
 */
export async function signInHref(): Promise<string> {
  const headerList = await headers();
  const path = sanitizeRedirectPath(headerList.get(REQUEST_PATH_HEADER));
  if (!path || path === "/home" || path.startsWith("/sign-in") || path.startsWith("/sign-up")) {
    return "/sign-in";
  }
  return `/sign-in?redirect_url=${encodeURIComponent(path)}`;
}
