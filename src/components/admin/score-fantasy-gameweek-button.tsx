"use client";

import { useState, useTransition } from "react";
import { Trophy, Check, AlertTriangle } from "lucide-react";
import { scoreFantasyGameweek, type ScoreFantasyGameweekResult } from "@/app/admin/data-health/fantasy-actions";

/** Data Health's per-gameweek scoring trigger — same shape as
 * ScorePredictionsButton, but bound to one gameweek since fantasy scoring
 * has no single "score everything" target (see scoreFantasyGameweek's doc
 * comment). Reports how many of the gameweek's fixtures were finished at
 * the time it ran, so a partial run (some fixtures still to be played)
 * reads as partial rather than final. */
export function ScoreFantasyGameweekButton({ gameweekId }: { gameweekId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ScoreFantasyGameweekResult | null>(null);

  function handleClick() {
    if (pending) return;
    setResult(null);
    startTransition(async () => {
      setResult(await scoreFantasyGameweek(gameweekId));
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        disabled={pending}
        onClick={handleClick}
        className="flex items-center gap-1.5 rounded-lg bg-kivo-cyan/15 px-3 py-1.5 text-xs font-semibold text-kivo-cyan transition hover:bg-kivo-cyan/25 disabled:opacity-50"
      >
        <Trophy className={`h-3.5 w-3.5 ${pending ? "animate-pulse" : ""}`} strokeWidth={2} />
        {pending ? "Scoring…" : "Score gameweek"}
      </button>

      {result && (
        <p className={`flex items-center gap-1 text-right text-[11px] ${result.error ? "text-critical" : "text-live"}`} role="status">
          {result.error ? (
            <>
              <AlertTriangle className="h-3 w-3 shrink-0" strokeWidth={2} />
              {result.error}
            </>
          ) : (
            <>
              <Check className="h-3 w-3 shrink-0" strokeWidth={2} />
              {result.recordsProcessed
                ? `Scored ${result.recordsProcessed} team${result.recordsProcessed === 1 ? "" : "s"}`
                : "No fantasy teams to score"}{" "}
              ({result.fixturesFinished ?? 0}/{result.fixturesTotal ?? 0} fixtures finished)
            </>
          )}
        </p>
      )}
    </div>
  );
}
