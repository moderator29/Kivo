import type { NextConfig } from "next";
import {
  EXTRA_IMAGE_HOSTS_ENV,
  imgSrcOrigins,
  missingImageHostWarning,
  remoteImagePatterns,
} from "./src/lib/football/image-hosts";

const isDev = process.env.NODE_ENV === "development";

function resolveSupabaseOrigin(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const supabaseOrigin = resolveSupabaseOrigin();
const extraImageHostsRaw = process.env[EXTRA_IMAGE_HOSTS_ENV];

function warnInvalidImageHost(value: string) {
  console.warn(
    `[next.config] Ignoring invalid entry "${value}" in ${EXTRA_IMAGE_HOSTS_ENV}. ` +
      `Expected a comma-separated list of bare hostnames (e.g. "r2.example.com") — no scheme, port, path or wildcard.`,
  );
}

// The one provider/host combination that breaks every image in the product
// without producing a single error. This is the earliest place it can be said —
// the build log of the deploy that introduces it.
const imageHostWarning = missingImageHostWarning({
  provider: process.env.FOOTBALL_DATA_PROVIDER,
  extraHostsRaw: extraImageHostsRaw,
});
if (imageHostWarning) console.warn(`[next.config] ${imageHostWarning}`);

// Both image allowlists below come from src/lib/football/image-hosts.ts, on
// purpose. They govern different halves of the same problem and were kept in
// sync by hand until they weren't:
//   - `images.remotePatterns` governs the call sites that route through
//     next/image's optimizer. An unlisted host throws in dev and answers 400
//     from /_next/image in production — a broken image on every row.
//   - the CSP's `img-src` governs the call sites that pass `unoptimized` and so
//     fetch the provider host directly from the browser (TeamCrest,
//     PlayerAvatar, CompetitionLogo, the fantasy pitch, the mobile nav —
//     RECOMMENDATIONS item 86: crests render at 20-56px, too small to be worth
//     the optimizer's round trip).
// `media.api-sports.io` was in the first list and missing from the second until
// 2026-08-18, which meant every club crest and player photo in the product was
// one real sync away from being blocked by KIVO's own security header. Deriving
// both from one constant is the actual fix; see that module's header for the
// rest, including why TheSportsDB's host is configuration rather than a guess.
//
// The remaining directives, and why each is what it is:
// - Supabase (@supabase/supabase-js): Auth, REST and Storage all live on the
//   single NEXT_PUBLIC_SUPABASE_URL origin. Since the 2026-08-18 move to
//   Supabase Auth (see DECISIONS.md), that origin also carries every auth
//   call the browser makes — /auth/v1/otp to request an email code and
//   /auth/v1/verify to redeem it — so connect-src needs it or sign-in
//   silently fails. The same origin serves the public `avatars` Storage
//   bucket (src/app/(app)/settings/avatar-actions.ts), so img-src needs it too.
// - No third-party auth script host is in this CSP any more: Supabase Auth
//   ships as part of the app bundle rather than loading a hosted widget, so
//   there is nothing here to keep in step with an auth provider's key (which
//   is exactly the build-time CSP trap ENVIRONMENT.md used to warn about).
// - Anthropic (@anthropic-ai/sdk) and the football data providers
//   (API-Football/TheSportsDB) are called only from server code
//   (src/lib/ai/client.ts, src/lib/football/) — never fetched from the
//   browser, so they need no browser-facing CSP entry.
// - Fonts (next/font/google) are self-hosted at build time — no runtime
//   request to fonts.googleapis.com/fonts.gstatic.com ever happens.
// - No analytics/tracking script is wired in anywhere (checked package.json
//   and grepped the app for gtag/posthog/segment/etc — none present).
const imageOrigins = imgSrcOrigins({
  extraHostsRaw: extraImageHostsRaw,
  supabaseOrigin,
  onInvalid: warnInvalidImageHost,
});

const cspDirectives = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: ${imageOrigins.join(" ")}`,
  `font-src 'self'`,
  `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  `frame-src 'self'`,
  `worker-src 'self' blob:`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `frame-ancestors 'none'`,
  `upgrade-insecure-requests`,
];

const securityHeaders = [
  { key: "Content-Security-Policy", value: cspDirectives.join("; ") },
  // Superseded by the CSP's frame-ancestors above in modern browsers, kept
  // for older ones that don't understand frame-ancestors yet.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: remoteImagePatterns(extraImageHostsRaw, warnInvalidImageHost),
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
