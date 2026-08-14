"use client";

import { useState, useTransition } from "react";
import { RefreshCw, Check, AlertTriangle } from "lucide-react";

type InlineSyncButtonProps = {
  label: string;
  action: () => Promise<{ error: string | null; recordsProcessed?: number }>;
};

/** Small inline variant of the Data Health "Sync now" button, dropped into an
 * empty-state section (team squad, match lineups, league standings) so an
 * admin can pull real data right where they noticed it's missing — no need to
 * hop over to the Data Health screen. Same server actions, same guards. */
export function InlineSyncButton({ label, action }: InlineSyncButtonProps) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error: string | null; recordsProcessed?: number } | null>(null);

  function handleClick() {
    if (pending) return;
    setResult(null);
    startTransition(async () => {
      setResult(await action());
    });
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={handleClick}
        className="flex items-center gap-2 rounded-lg bg-kivo-cyan/15 px-3 py-1.5 text-xs font-semibold text-kivo-cyan transition hover:bg-kivo-cyan/25 disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} strokeWidth={2} />
        {pending ? "Syncing…" : label}
      </button>
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
              Synced {result.recordsProcessed ?? 0} record{result.recordsProcessed === 1 ? "" : "s"} — refresh to see it
            </>
          )}
        </p>
      )}
    </div>
  );
}
