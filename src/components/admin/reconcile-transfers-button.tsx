"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Check, AlertTriangle } from "lucide-react";
import { reconcileTransferTeams } from "@/app/admin/football/actions";

/**
 * RECOMMENDATIONS.md item 64: resolveTeamId in src/lib/football/sync-transfers.ts
 * leaves a transfer's from_team_id/to_team_id null when that club wasn't synced
 * yet at the time — this button re-checks provider_mappings for every such row,
 * now that more teams may have been synced since. Zero provider quota spent
 * (see reconcileUnresolvedTransferTeams's doc comment), so unlike every other
 * button on this page there's no "no provider connected" gate on it.
 */
export function ReconcileTransfersButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error: string | null; recordsProcessed?: number } | null>(null);

  function handleClick() {
    if (pending) return;
    setResult(null);
    startTransition(async () => {
      setResult(await reconcileTransferTeams());
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={handleClick}
        className="flex min-h-11 items-center gap-2 rounded-lg bg-surface-1 px-4 text-sm font-semibold text-foreground-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
      >
        <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} strokeWidth={2} />
        {pending ? "Reconciling…" : "Reconcile unresolved clubs"}
      </button>

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
              Resolved {result.recordsProcessed ?? 0} transfer{result.recordsProcessed === 1 ? "" : "s"}
            </>
          )}
        </p>
      )}
    </div>
  );
}
