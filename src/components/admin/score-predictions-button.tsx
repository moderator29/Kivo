"use client";

import { useState, useTransition } from "react";
import { Trophy, Check, AlertTriangle } from "lucide-react";
import { scorePredictions } from "@/app/admin/data-health/predictions-actions";

export function ScorePredictionsButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error: string | null; recordsProcessed?: number } | null>(null);

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
        onClick={handleClick}
        className="flex items-center gap-2 rounded-lg bg-kivo-cyan/15 px-4 py-2 text-sm font-semibold text-kivo-cyan transition hover:bg-kivo-cyan/25 disabled:opacity-50"
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
              Scored {result.recordsProcessed ?? 0} prediction{result.recordsProcessed === 1 ? "" : "s"}
            </>
          )}
        </p>
      )}
    </div>
  );
}
