import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
import { MotionConfig } from "motion/react";
import { Analytics } from "@vercel/analytics/next";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemeScript } from "@/components/theme/theme-script";
import { KivoInkFilter } from "@/components/theme/ink-filter";
import { DEFAULT_THEME, THEME_COLOR } from "@/lib/theme";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

// Geist Mono is used on exactly four surfaces — the error reference code, the
// sign-in code input, and two invite-code fields in the prediction leagues
// panel. None of them is public, and `next/font` preloaded the face on every
// route regardless: a second render-blocking request, 22.6 KB, ahead of the
// typeface the page is actually set in, on a pipe that moves ~50 KB/s.
//
// `preload: false` stops the request on routes that never use it. `display:
// "optional"` means that where it IS used the browser either has it almost
// immediately or keeps the fallback and never swaps — the swap is the reflow,
// and the reflow was the CLS.
//
// The explicit `fallback` list is the part that is easy to leave out and
// shouldn't be. Next's `adjustFontFallback` emits a size-adjusted face anchored
// to `src: local("Arial")`, and Android has no Arial: the `local()` never
// matches, the metric-matched face is dropped, and the adjustment silently does
// nothing on exactly the devices this product is being launched for. Naming
// monospace families Android actually ships makes the fallback real.
//
// Measured, /support: two font requests (49.2 KB) -> one (26.6 KB), and CLS
// 0.209 worst-case -> 0.0155 stable. See docs/PERFORMANCE.md.
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
  display: "optional",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});

// Resolved through src/lib/site-url.ts rather than read from the environment
// here: metadata is evaluated at build time, so this must never throw no
// matter what is configured, and an env var Vercel knows about but has not
// been given a value resolves to `""` rather than `undefined`. siteUrl()
// handles both, and falls back to Vercel's own production URL before it falls
// back to localhost (KN-20).
const site = siteUrl();
const description =
  "KIVO is a premium football fan platform: live scores, an AI Copilot grounded in real data, match rooms, fantasy, and predictions. Built for football lovers.";

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: {
    default: "KIVO: Football. Together. Live.",
    template: "%s | KIVO",
  },
  description,
  openGraph: {
    title: "KIVO: Football. Together. Live.",
    description,
    type: "website",
    url: site,
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
        <KivoInkFilter />
        <ThemeProvider>
          {/* No auth provider wrapper any more: Supabase Auth's session lives
              in cookies that the server reads directly (src/lib/auth.ts) and
              that @supabase/ssr's browser client reads on demand
              (src/lib/supabase/client.ts), so nothing needs a React context
              around the tree. This is where Clerk's ThemedClerkProvider used
              to sit — it had to be inside ThemeProvider because Clerk was
              themed from React state rather than CSS variables. KIVO's own
              sign-in form (src/components/auth/email-code-form.tsx) is styled
              from the same design tokens as the rest of the app, so it follows
              the theme with no bridging at all. */}
          {app}
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
