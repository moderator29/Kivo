"use client";

// Error boundaries must be Client Components (Next.js requirement).
//
// This is a route-segment error boundary nested inside the root layout, so
// (like not-found.tsx) it must NOT render its own <html>/<body> tags — only
// global-error.tsx (which replaces the root layout entirely) does that.
//
// Next.js version note: this app runs a version where the error component
// receives both `retry` and `reset` (see node_modules/next/dist/docs/01-app/
// 03-api-reference/03-file-conventions/error.md). `retry()` re-fetches and
// re-renders the failed segment (calls router.refresh() first) so it can
// actually recover from a data-fetch error, not just clear the boundary —
// the docs call this out as the one to prefer ("in most cases, you should
// use retry() instead"), so the "Try again" button below uses it.

import Link from "next/link";
import Image from "next/image";
import { AlertTriangle, LifeBuoy } from "lucide-react";
import kivoLogo from "../../public/brand/kivo-logo-transparent.webp";
import { ErrorReference } from "@/components/ui/error-reference";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <div className="kivo-glass-brand flex w-full max-w-md flex-col items-center gap-7 rounded-3xl px-8 py-12">
        <Image src={kivoLogo} alt="" width={48} height={48} className="kivo-ink h-12 w-12 shrink-0" priority />

        <div className="kivo-gradient-intelligence flex h-16 w-16 items-center justify-center rounded-2xl">
          <AlertTriangle className="h-8 w-8 text-on-accent" strokeWidth={1.5} />
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-foreground">Something went wrong.</h1>
          <p className="max-w-sm text-sm leading-relaxed text-foreground-muted">
            An unexpected error interrupted this page. Try again, or head back to Home if it keeps happening.
          </p>
        </div>

        <ErrorReference error={error} boundary="root" />

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={retry}
            className="kivo-gradient-prime rounded-xl px-5 py-2.5 text-sm font-semibold text-on-accent kivo-raise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Try again
          </button>
          <Link
            href="/home"
            className="rounded-xl border border-hairline px-5 py-2.5 text-sm font-semibold text-foreground-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Back to Home
          </Link>
        </div>

        {/* KN-55: same route to a person as the (app) boundary offers. The
            reference above is what makes a report actionable, so the two
            belong next to each other. */}
        <Link
          href="/support?topic=bug"
          className="flex items-center gap-1.5 text-xs font-medium text-foreground-subtle transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <LifeBuoy className="h-3.5 w-3.5" strokeWidth={2} />
          Tell us what happened
        </Link>
      </div>
    </div>
  );
}
