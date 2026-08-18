import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import { MotionConfig } from "motion/react";
import { Analytics } from "@vercel/analytics/next";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemeScript } from "@/components/theme/theme-script";
import { ThemedClerkProvider } from "@/components/theme/themed-clerk-provider";
import { DEFAULT_THEME, THEME_COLOR } from "@/lib/theme";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// `||`, not `??`: an env var Vercel knows about but that hasn't been given a
// value yet resolves to `""`, not `undefined` — `""  ?? fallback` still
// evaluates to `""`, and `new URL("")` throws, which fails the entire build
// (metadata objects are evaluated at build time). This must never throw
// regardless of what's configured, so every env var used below falls back to
// a working default the same way.
const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const description =
  "KIVO is a premium football fan platform: live scores, an AI Copilot grounded in real data, match rooms, fantasy, and predictions. Built for football lovers.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "KIVO: Football. Together. Live.",
    template: "%s | KIVO",
  },
  description,
  openGraph: {
    title: "KIVO: Football. Together. Live.",
    description,
    type: "website",
    url: siteUrl,
    siteName: "KIVO",
    // Image itself comes from opengraph-image.tsx (file-based metadata takes
    // priority over this object per Next's docs), so no `images` entry here.
  },
  twitter: {
    card: "summary_large_image",
    title: "KIVO: Football. Together. Live.",
    description,
    // Same story as openGraph above — twitter-image.tsx supplies the image.
  },
};

// Tints iOS Safari's chrome and Android's toolbar so they match the page
// instead of defaulting to white.
//
// Deliberately a single, non-media-scoped value rather than a
// prefers-color-scheme pair: the user can pick a theme that disagrees with
// their OS, and a media-scoped meta tag can never express that. ThemeProvider
// rewrites this tag's content on mount to whatever is actually painted, which
// is only possible if there is exactly one unscoped tag to rewrite. The value
// here is what the chrome shows for the few hundred milliseconds before that
// runs, so it matches DEFAULT_THEME.
//
// `colorScheme` is likewise not declared here — it is set per theme on the
// [data-theme] blocks in globals.css and mirrored onto the root element by the
// pre-paint script, so native chrome follows the chosen theme rather than
// being pinned to one.
export const viewport: Viewport = {
  themeColor: THEME_COLOR[DEFAULT_THEME],
};

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default function RootLayout({ children }: LayoutProps<"/">) {
  const app = <MotionConfig reducedMotion="user">{children}</MotionConfig>;

  return (
    <html
      lang="en"
      // Stamped so the token blocks in globals.css have something to match
      // during the microtask before <ThemeScript> runs; the script overwrites
      // it with the user's real theme before first paint.
      // `suppressHydrationWarning` is required precisely because of that
      // rewrite — React would otherwise flag the attribute it rendered
      // ("dark") not matching the one in the DOM ("light") as a hydration
      // mismatch. It suppresses the warning for this element's own attributes
      // only, not for its subtree.
      data-theme={DEFAULT_THEME}
      suppressHydrationWarning
      className={`${jakarta.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {/* First child of <body> on purpose: it must run synchronously before
            the browser parses and paints any real content, or every load
            flashes the default theme before settling on the chosen one. */}
        <ThemeScript />
        <ThemeProvider>
          {/* Clerk is themed from React state rather than CSS variables (see
              ThemedClerkProvider), so it has to sit INSIDE ThemeProvider. It
              also throws immediately without a publishable key, so public
              pages like the marketing landing page still render without it
              when Clerk isn't configured for the environment. */}
          {clerkConfigured ? <ThemedClerkProvider>{app}</ThemedClerkProvider> : app}
          {/* RECOMMENDATIONS.md item 212: cookieless, privacy-respecting page
              view counts — no PII, no fingerprinting, nothing for a user to
              consent to. Served same-origin (/_vercel/insights/*) in
              production, so no CSP change is needed; a no-op when the app
              isn't deployed on Vercel (fetch to a relative path 404s quietly,
              same as any other unhosted static asset). */}
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  );
}
