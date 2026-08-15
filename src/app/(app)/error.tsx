"use client";

// Error boundaries must be Client Components (Next.js requirement).
//
// Placed at the (app) route group root so it wraps every page under the
// signed-in/guest app shell (matches, teams, players, social, etc.) in one
// boundary, without needing a copy per route. Per the component hierarchy
// (see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
// error.md), error.js wraps page.js and nested layout.js files but NOT the
// layout.js in the same segment — so src/app/(app)/layout.tsx's AppShell
// (nav sidebar/top bar/bottom nav) keeps rendering around this fallback,
// which is exactly what keeps a failed route feeling like part of the app
// instead of ejecting the user out of it.
//
// Next.js version note: this app runs a version where the error component
// receives both `retry` and `reset` — the docs call out `retry()` as the one
// to prefer in most cases ("attempt to recover by re-fetching and
// re-rendering the segment"), so that's what the button below uses. See
// src/app/error.tsx for the same note in more detail.

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export default function AppSegmentError({
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
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <div className="kivo-glass-brand flex w-full max-w-md flex-col items-center gap-7 rounded-3xl px-8 py-12">
        <div className="kivo-gradient-intelligence flex h-16 w-16 items-center justify-center rounded-2xl">
          <AlertTriangle className="h-8 w-8 text-kivo-white" strokeWidth={1.75} />
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-foreground">Something went wrong.</h1>
          <p className="max-w-sm text-sm leading-relaxed text-foreground-muted">
            This page hit a snag loading. Try again, or head back to Home if it keeps happening.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={retry}
            className="kivo-gradient-prime rounded-xl px-5 py-2.5 text-sm font-semibold text-kivo-white transition-opacity hover:opacity-90"
          >
            Try again
          </button>
          <Link
            href="/home"
            className="rounded-xl border border-white/10 px-5 py-2.5 text-sm font-semibold text-foreground-muted transition hover:bg-white/5"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
