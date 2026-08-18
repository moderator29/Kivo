"use client";

// Error boundaries must be Client Components (Next.js requirement).
//
// global-error.tsx handles errors thrown in the root layout itself (see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
// error.md, "Global Error"). It REPLACES the root layout when active, so
// unlike src/app/error.tsx and src/app/(app)/error.tsx it must define its
// own <html>/<body> tags and pull in whatever global styles/fonts it needs
// itself — nothing from src/app/layout.tsx (ClerkProvider, next/font
// loaders, etc.) is available here. Importing globals.css is enough to get
// KIVO's design tokens (--background, --foreground, .kivo-glass-brand,
// .kivo-gradient-*) since those are plain CSS custom properties, not
// dependent on the font loader's className being present on <html>; the
// font itself just falls back to the browser default here, which the docs
// call out as an acceptable, lighter-weight trade-off for this rare a path.
//
// KIVO is dual-theme: every token in globals.css lives under a
// [data-theme] block, so an <html> with no `data-theme` attribute resolves
// NONE of them (--background, --foreground, --surface-* would all be
// undefined) and this fallback would render unstyled. Since this component
// replaces the root layout, it has to set the attribute itself: it renders
// with DEFAULT_THEME server-side and pulls in the same blocking <ThemeScript>
// the root layout uses, so a light-mode user still gets light mode here
// without a flash.
//
// Next.js version note: this app runs a version where the error component
// receives both `retry` and `reset` — the docs call out `retry()` as the one
// to prefer in most cases. See src/app/error.tsx for the same note in more
// detail.

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { ThemeScript } from "@/components/theme/theme-script";
import { DEFAULT_THEME } from "@/lib/theme";
import "./globals.css";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // No error-tracking service wired up yet — that's a separate decision.
    // This at least keeps the failure visible in server/console logs.
    console.error(error);
  }, [error]);

  return (
    <html lang="en" data-theme={DEFAULT_THEME} className="h-full antialiased">
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full bg-background text-foreground">
        <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
          <div className="kivo-glass-brand flex w-full max-w-md flex-col items-center gap-7 rounded-3xl px-8 py-12">
            <div className="kivo-gradient-intelligence flex h-16 w-16 items-center justify-center rounded-2xl">
              <AlertTriangle className="h-8 w-8 text-on-accent" strokeWidth={1.75} />
            </div>

            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold text-foreground">Something went wrong.</h1>
              <p className="max-w-sm text-sm leading-relaxed text-foreground-muted">
                KIVO hit an unexpected error and couldn&apos;t load. Try again, or come back in a moment.
              </p>
            </div>

            <button
              type="button"
              onClick={retry}
              className="kivo-gradient-prime rounded-xl px-5 py-2.5 text-sm font-semibold text-on-accent kivo-raise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
