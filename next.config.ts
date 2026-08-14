import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Decodes Clerk's frontend API host straight out of the publishable key
 * (pk_test_<base64>/pk_live_<base64>, where the base64 segment decodes to
 * "<frontend-api-host>$") instead of hardcoding a domain — this way the CSP
 * always matches whichever Clerk instance (dev *.clerk.accounts.dev, or a
 * production custom domain) the app is actually configured with. Falls back
 * to Clerk's own documented dev domain pattern if no key is set yet (e.g. a
 * fresh checkout before ENVIRONMENT.md's setup steps have run) so the CSP
 * still resolves to something rather than crashing config evaluation.
 */
function resolveClerkFrontendApiHost(): string {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const encoded = key?.split("_")[2];
  if (encoded) {
    try {
      const decoded = Buffer.from(encoded, "base64").toString("utf-8").replace(/\$+$/, "");
      if (decoded) return decoded;
    } catch {
      // fall through to the default below
    }
  }
  return "*.clerk.accounts.dev";
}

function resolveSupabaseOrigin(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const clerkFrontendApiHost = resolveClerkFrontendApiHost();
const supabaseOrigin = resolveSupabaseOrigin();

// Built from what this app actually loads, not a generic template:
// - Clerk (@clerk/nextjs): its frontend API host serves clerk-js and handles
//   sign-in/session calls; img.clerk.com serves user avatars; Cloudflare
//   Turnstile (challenges.cloudflare.com) is Clerk's built-in bot-protection
//   widget, loaded in an iframe for every Clerk instance, not something this
//   app opted into separately.
// - Supabase (@supabase/supabase-js): both the server- and browser-side
//   clients (src/lib/supabase/server.ts, src/lib/supabase/client.ts) talk to
//   NEXT_PUBLIC_SUPABASE_URL directly over REST.
// - Anthropic (@anthropic-ai/sdk) and the football data providers
//   (API-Football/Sportmonks) are called only from server code
//   (src/lib/ai/client.ts, src/lib/football/) — never fetched from the
//   browser, so they need no browser-facing CSP entry.
// - Fonts (next/font/google) are self-hosted at build time — no runtime
//   request to fonts.googleapis.com/fonts.gstatic.com ever happens.
// - No analytics/tracking script is wired in anywhere (checked package.json
//   and grepped the app for gtag/posthog/segment/etc — none present).
const cspDirectives = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' https://${clerkFrontendApiHost} https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: https://img.clerk.com https://images.clerkstage.dev`,
  `font-src 'self'`,
  `connect-src 'self' https://${clerkFrontendApiHost} https://clerk-telemetry.com https://*.clerk-telemetry.com https://img.clerk.com${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
  `frame-src 'self' https://${clerkFrontendApiHost} https://challenges.cloudflare.com`,
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
