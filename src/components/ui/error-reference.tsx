"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { logError } from "@/lib/log";

/**
 * The quotable half of an error boundary (docs/BUG_AUDIT_2026-08-18.md:
 * "until that's wired, every production error is a screenshot and a guess").
 *
 * React attaches a `digest` — a short hash of the real error — to every error
 * it hands a boundary after a *server* failure, and Next.js logs the full
 * stack against that same digest server-side (src/instrumentation.ts adds
 * route/method/renderSource to that line). Showing the digest to the user
 * therefore turns "it said something went wrong" into a lookup key: the
 * founder can grep Vercel's runtime logs for it and land on the exact stack.
 *
 * A *client*-side failure (a hydration mismatch, a throw inside a client
 * component) never reaches the server and so has no digest and no server log
 * line. Inventing a reference number for it would be worse than useless — it
 * would point at nothing — so this shows the error's own name and message
 * instead, which is the only thing that actually exists to quote. Either way
 * the full error is logged to the browser console in the same structured
 * shape the server uses.
 *
 * `window.location.pathname` rather than `usePathname()` on purpose: this
 * renders inside global-error.tsx too, which replaces the root layout, and a
 * component whose job is to explain a crash must not be able to cause one by
 * depending on a React context that may not be mounted.
 */
export function ErrorReference({
  error,
  boundary,
}: {
  error: Error & { digest?: string };
  boundary: string;
}) {
  const [copied, setCopied] = useState(false);
  const digest = error.digest;
  const reference = digest ?? `${error.name}: ${error.message}`;

  useEffect(() => {
    logError(`errorBoundary.${boundary}`, error, {
      route: typeof window === "undefined" ? undefined : window.location.pathname,
      digest: error.digest ?? null,
    });
  }, [error, boundary]);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timeout);
  }, [copied]);

  function handleCopy() {
    navigator.clipboard?.writeText(reference).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-1.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">
        {digest ? "Reference — quote this when reporting it" : "What failed"}
      </p>
      <div className="flex w-full items-center justify-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-hairline bg-surface-2 px-2.5 py-1.5 text-left font-mono text-[11px] text-foreground-muted">
          {reference}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? "Copied" : "Copy error reference"}
          className="shrink-0 rounded-lg border border-hairline p-1.5 text-foreground-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {copied ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : <Copy className="h-3.5 w-3.5" strokeWidth={2} />}
        </button>
      </div>
    </div>
  );
}
