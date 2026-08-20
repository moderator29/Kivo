"use client";

import { useState, useTransition } from "react";
import { Trash2, Check, X, AlertTriangle } from "lucide-react";
import { pruneSyncRuns } from "@/app/admin/football/actions";

// This is the most consequential action on Data health — an irreversible
// delete of sync_runs history — so it gets the same arm-then-confirm pattern
// already established by ReportRow's moderation decisions, instead of firing
// on the first click like the other, non-destructive sync buttons on this page.
export function PruneSyncRunsButton() {
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  const [result, setResult] = useState<{ error: string | null; recordsProcessed?: number } | null>(null);

  function handleClick() {
    if (pending) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setResult(null);
    startTransition(async () => {
      const outcome = await pruneSyncRuns();
      setResult(outcome);
      setArmed(false);
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          aria-busy={pending}
          onClick={handleClick}
          className={`flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50 ${
            armed ? "bg-critical/15 text-critical hover:bg-critical/25" : "bg-surface-1 text-foreground-muted hover:bg-surface-2"
          }`}
        >
          <Trash2 className={`h-4 w-4 ${pending ? "animate-pulse" : ""}`} strokeWidth={2} />
          {pending ? "Pruning…" : armed ? "Confirm prune" : "Prune old sync runs"}
        </button>
        {armed && !pending && (
          <button
            type="button"
            onClick={() => setArmed(false)}
            aria-label="Cancel prune"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-foreground-subtle transition hover:bg-surface-2 hover:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {result && (
        <p
          className={`flex items-center gap-1.5 text-xs ${result.error ? "text-critical" : "text-live"}`}
          role="status"
        >
          {result.error ? (
            <>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              {result.error}
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              Removed {result.recordsProcessed ?? 0} run{result.recordsProcessed === 1 ? "" : "s"} older than 90 days
            </>
          )}
        </p>
      )}
    </div>
  );
}
