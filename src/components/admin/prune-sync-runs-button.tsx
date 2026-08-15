"use client";

import { useState, useTransition } from "react";
import { Trash2, Check, AlertTriangle } from "lucide-react";
import { pruneSyncRuns } from "@/app/admin/data-health/actions";

export function PruneSyncRunsButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error: string | null; recordsProcessed?: number } | null>(null);

  function handleClick() {
    if (pending) return;
    setResult(null);
    startTransition(async () => {
      const outcome = await pruneSyncRuns();
      setResult(outcome);
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={handleClick}
        className="flex items-center gap-2 rounded-lg bg-white/5 px-4 py-2 text-sm font-semibold text-foreground-muted transition hover:bg-white/10 disabled:opacity-50"
      >
        <Trash2 className={`h-4 w-4 ${pending ? "animate-pulse" : ""}`} strokeWidth={2} />
        {pending ? "Pruning…" : "Prune old sync runs"}
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
              Removed {result.recordsProcessed ?? 0} run{result.recordsProcessed === 1 ? "" : "s"} older than 90 days
            </>
          )}
        </p>
      )}
    </div>
  );
}
