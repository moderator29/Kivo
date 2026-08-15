import { ChevronDown } from "lucide-react";
import { SCORING_RULES_SUMMARY } from "@/lib/fantasy-scoring";

/**
 * Publishes the scoring rules inline so points are auditable (RECOMMENDATIONS
 * item 5) — same precedent as PredictionsLeaderboard's "3 pts per correct
 * pick" label, just expandable since fantasy has several rules instead of
 * one. Values come straight from src/lib/fantasy-scoring.ts, the same module
 * scoreFantasyGameweek computes from, so this can never drift out of sync
 * with what actually gets scored. Shared between the Squad tab (next to the
 * Points stat tile) and the Leaderboard tab so it's visible wherever a
 * viewer might ask "why did I get this many points".
 */
export function HowScoringWorks() {
  return (
    <details className="kivo-glass group rounded-2xl p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-foreground-muted">
        How scoring works
        <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" strokeWidth={2} />
      </summary>
      <ul className="mt-3 flex flex-col gap-1.5 text-xs text-foreground-subtle">
        {SCORING_RULES_SUMMARY.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
    </details>
  );
}
