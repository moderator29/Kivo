import type { NextConfig } from "next";

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

// Built from what this app actually loads, not a generic template:
// - Supabase (@supabase/supabase-js): Auth, REST and Storage all live on the
//   single NEXT_PUBLIC_SUPABASE_URL origin. Since the 2026-08-18 move to
//   Supabase Auth (see DECISIONS.md), that origin also carries every auth
//   call the browser makes — /auth/v1/otp to request an email code and
//   /auth/v1/verify to redeem it — so connect-src needs it or sign-in
//   silently fails. The same origin serves the public `avatars` Storage
//   bucket (uploaded profile photos, see
//   src/app/(app)/settings/avatar-actions.ts), so img-src needs it too.
// - media.api-sports.io serves every club crest and player photo. It is in
//   BOTH lists below and needs to be: `remotePatterns` covers the call sites
//   that still route through next/image's optimizer (the standings table in
//   match-centre-tabs.tsx, the competition logos in leagues/[id] and
//   leagues-list, recently-viewed-strip), while `img-src` covers the ones that
//   deliberately bypass it — TeamCrest and PlayerAvatar pass `unoptimized`
//   (RECOMMENDATIONS item 86: crests render at 20-56px, too small to be worth
//   the optimizer's round trip), which makes the browser fetch the provider
//   host directly and therefore subject to this CSP. It was missing from
//   `img-src` until 2026-08-18: every crest and player photo in the app would
//   have been blocked outright the moment real football data was synced, and
//   nothing surfaced it earlier only because no sync has run yet.
// - TheSportsDB's image host is deliberately NOT listed, because it could not
//   be verified rather than because it isn't needed. `FOOTBALL_DATA_PROVIDER=
//   thesportsdb` returns badge URLs in `strBadge`
//   (src/lib/football/providers/thesportsdb.ts) whose host is a real unknown:
//   thesportsdb.com is unreachable from the sandbox this was written in — the
//   same limitation that file's own header comment already documents about its
//   endpoint shapes — so adding a hostname here would be a guess, and a wrong
//   guess in `remotePatterns` throws at render time rather than degrading. If
//   that provider is ever switched on, the host must be added to BOTH lists,
//   read off a real API response. Tracked in RECOMMENDATIONS.md.
// - img.clerk.com is the ONE Clerk host that survives the 2026-08-18 auth
//   migration, and only in img-src. `profiles.avatar_url` still holds
//   Clerk-hosted photo URLs on the handful of rows created before the
//   migration; nothing writes that column any more, but those images are
//   still rendered as a last-resort fallback by resolveAvatarSrc()
//   (src/lib/kivo-assets.ts), including to other users on public profiles.
//   Dropping the host would silently break them, so it stays until those rows
//   are backfilled or nulled — tracked in RECOMMENDATIONS.md.
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
const cspDirectives = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: https://media.api-sports.io https://img.clerk.com${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
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
    // API-Football serves team crests from this CDN — required for next/image to
    // render them on the Matches page without erroring on an unconfigured host.
    remotePatterns: [{ protocol: "https", hostname: "media.api-sports.io" }],
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
