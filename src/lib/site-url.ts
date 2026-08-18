import { logError } from "@/lib/log";
/**
 * The one place KIVO decides what its own absolute URL is.
 *
 * Before this module the string `process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"`
 * was copy-pasted into four production-critical places (`KIVO_NEXT_GEN.md` KN-20):
 * the root layout's `metadataBase`, `sitemap.ts`, `robots.ts`, and the share
 * link `/matches/[id]` hands the user. If that variable is ever unset or empty
 * on a deploy — and Vercel resolves a declared-but-unvalued variable to `""`,
 * not `undefined` — KIVO publishes a sitemap of localhost URLs and offers
 * people share links to their own machine, with no error anywhere.
 *
 * Rather than making the variable required (which would fail a build the
 * founder is trying to ship), the fallback chain below ends at something that
 * is *correct on Vercel without any configuration at all*:
 *
 *   1. NEXT_PUBLIC_APP_URL          — explicit, wins whenever it has a value.
 *   2. VERCEL_PROJECT_PRODUCTION_URL — the project's stable production domain,
 *      injected by Vercel into every build and runtime (including preview
 *      deployments, which is what we want for canonical/sitemap URLs: a
 *      preview must never advertise itself as the canonical site).
 *   3. http://localhost:3000        — development only.
 *
 * Reaching step 3 in a production runtime is a real misconfiguration, so it is
 * logged loudly (once) instead of passing silently. It still returns a valid
 * URL: nothing here may ever throw, because `metadataBase` is evaluated at
 * build time and a throw there fails the entire build.
 */

const LOCAL_FALLBACK = "http://localhost:3000";

function normalise(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  // Vercel's system variables are bare hostnames ("kivo.vercel.app"); an
  // explicitly configured NEXT_PUBLIC_APP_URL normally already has a scheme.
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    // Strip any trailing slash so callers can always append a path directly.
    return new URL(withScheme).origin;
  } catch {
    return undefined;
  }
}

let warned = false;

/**
 * Absolute origin of this KIVO deployment, with no trailing slash.
 * Safe to call at build time and at request time; never throws.
 */
export function siteUrl(): string {
  const resolved = normalise(process.env.NEXT_PUBLIC_APP_URL) ?? normalise(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (resolved) return resolved;

  if (process.env.NODE_ENV === "production" && !warned) {
    warned = true;
    logError("siteUrl.noConfiguredOrigin", "NEXT_PUBLIC_APP_URL is not set and no Vercel production URL is available. " +
        "Canonical metadata, the sitemap, robots.txt and share links are falling back to " +
        `${LOCAL_FALLBACK}, which is wrong for anyone but the machine running this process.`);
  }
  return LOCAL_FALLBACK;
}

/** `siteUrl()` with a path appended. `path` must start with "/". */
export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path}`;
}

/**
 * Origins this deployment is allowed to send a user back to from an email link.
 *
 * KN-125: `emailRedirectTo` used to be built from `x-forwarded-host`, a header
 * the caller controls. Supabase re-validates that URL against the project's own
 * redirect allow-list, but that allow-list is dashboard configuration that
 * appears nowhere in this repo — nothing here proves it is set, so KIVO must
 * not rely on it as its only defence.
 *
 * The naive fix (always use `siteUrl()`) breaks preview deployments: the sign-in
 * cookies were set on the preview host, so a link pointing at production cannot
 * complete there. So instead of discarding the request host, we *check* it: the
 * host is used only when it is one this deployment genuinely answers on. Every
 * entry below comes from server-side configuration, never from the request.
 */
export function trustedOrigins(): string[] {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
    // The immutable per-deployment URL, and the stable per-branch alias.
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
  ];

  const origins = new Set<string>();
  for (const candidate of candidates) {
    const origin = normalise(candidate);
    if (origin) origins.add(origin);
  }
  // Development only — in production this would re-open exactly the hole the
  // allow-list exists to close.
  if (process.env.NODE_ENV !== "production") {
    origins.add(LOCAL_FALLBACK);
    origins.add("http://localhost:3001");
  }
  origins.add(siteUrl());
  return [...origins];
}

/**
 * Resolve a request's own origin, but only if this deployment actually answers
 * on it. Anything else falls back to the canonical `siteUrl()`.
 */
export function trustedOriginFor(host: string | null, protocol: string | null): string {
  if (!host) return siteUrl();
  const scheme = protocol?.split(",")[0]?.trim() || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  const candidate = normalise(`${scheme}://${host.split(",")[0]?.trim()}`);
  if (!candidate) return siteUrl();
  return trustedOrigins().includes(candidate) ? candidate : siteUrl();
}
