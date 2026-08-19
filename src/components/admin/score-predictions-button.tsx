"use client";

import { useState, useTransition } from "react";
import { Trophy, Check, AlertTriangle } from "lucide-react";
import { scorePredictions } from "@/app/admin/data-health/predictions-actions";

export function ScorePredictionsButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{
    error: string | null;
    recordsProcessed?: number;
    unresolvedCount?: number;
  } | null>(null);

  function handleClick() {
    if (pending) return;
    setResult(null);
    startTransition(async () => {
      const outcome = await scorePredictions();
      setResult(outcome);
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={handleClick}
        className="flex items-center gap-2 rounded-lg bg-accent/15 px-4 py-2 text-sm font-semibold text-accent transition hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
      >
        <Trophy className={`h-4 w-4 ${pending ? "animate-pulse" : ""}`} strokeWidth={2} />
        {pending ? "Scoring…" : "Score predictions"}
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
              {/* Two separate numbers on purpose. Folding rows KIVO declined
                  to settle into the "scored" count would make a pass that
                  resolved nothing look like a pass that worked. */}
              Scored {result.recordsProcessed ?? 0} prediction{result.recordsProcessed === 1 ? "" : "s"}
              {(result.unresolvedCount ?? 0) > 0 &&
                ` · ${result.unresolvedCount} left unresolved (data not synced)`}
            </>
          )}
        </p>
      )}
    </div>
  );
}
