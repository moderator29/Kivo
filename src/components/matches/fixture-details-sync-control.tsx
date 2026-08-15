"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Check, AlertTriangle } from "lucide-react";

type FixtureDetailsSyncAction = (
  autoSyncMissingSquads: boolean,
) => Promise<{ error: string | null; recordsProcessed?: number }>;

/**
 * Sync control for one fixture's details (lineups/events/stats), specifically for
 * RECOMMENDATIONS.md item 59: syncFixtureDetails no longer auto-syncs a missing
 * squad by default (2+ extra provider calls per unseen team), so the admin needs a
 * way to opt into that spend deliberately rather than it happening silently. The
 * checkbox defaults unchecked — same "protect the quota by default" rule as the
 * server action itself — and its state is read at click time, not persisted.
 */
export function FixtureDetailsSyncControl({ action }: { action: FixtureDetailsSyncAction }) {
  const [pending, startTransition] = useTransition();
  const [autoSyncMissingSquads, setAutoSyncMissingSquads] = useState(false);
  const [result, setResult] = useState<{ error: string | null; recordsProcessed?: number } | null>(null);

  function handleClick() {
    if (pending) return;
    setResult(null);
    startTransition(async () => {
      setResult(await action(autoSyncMissingSquads));
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-foreground-subtle">
          <input
            type="checkbox"
            checked={autoSyncMissingSquads}
            onChange={(e) => setAutoSyncMissingSquads(e.target.checked)}
            className="h-3 w-3 rounded border-white/20 bg-transparent accent-kivo-cyan"
          />
          Also sync missing squads (extra quota)
        </label>
        <button
          type="button"
          disabled={pending}
          aria-busy={pending}
          onClick={handleClick}
          className="flex items-center gap-2 rounded-lg bg-kivo-cyan/15 px-3 py-1.5 text-xs font-semibold text-kivo-cyan transition hover:bg-kivo-cyan/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} strokeWidth={2} />
          {pending ? "Syncing…" : "Sync match details"}
        </button>
      </div>
      {!autoSyncMissingSquads && !result && (
        <p className="max-w-[18rem] text-right text-[11px] text-foreground-subtle">
          Lineup entries for a team with no squad synced yet will be skipped until you sync that team&apos;s squad,
          or check the box above.
        </p>
      )}
      {result && (
        <p className={`flex items-center gap-1 text-[11px] ${result.error ? "text-critical" : "text-live"}`} role="status">
          {result.error ? (
            <>
              <AlertTriangle className="h-3 w-3 shrink-0" strokeWidth={2} />
              {result.error}
            </>
          ) : (
            <>
              <Check className="h-3 w-3 shrink-0" strokeWidth={2} />
              Synced {result.recordsProcessed ?? 0} record{result.recordsProcessed === 1 ? "" : "s"}. Refresh to see it
            </>
          )}
        </p>
      )}
    </div>
  );
}
