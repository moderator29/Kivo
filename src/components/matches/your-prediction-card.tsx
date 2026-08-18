import Link from "next/link";
import { Target } from "lucide-react";
import { PREDICTION_OUTCOME_LABEL, predictionResultInfo, type PredictionOutcome } from "@/lib/predictions";
import type { FixtureStatus } from "@/lib/football/fixture-status";

type YourPredictionCardProps = {
  predictedOutcome: PredictionOutcome;
  pointsAwarded: number | null;
  status: FixtureStatus;
};

/**
 * RECOMMENDATIONS.md item 293: `predictions.fixture_id` and this page's own
 * `fixture.id` are the identical real foreign key, but Match Centre never
 * joined them — a user who picked "Home win" on /predictions got no
 * acknowledgment of that pick anywhere on the match they picked it for.
 * MatchCentrePage queries the caller's own prediction for this exact fixture
 * (predictions_select_own already scopes this to their own row — no RLS
 * change) and renders nothing at all when there isn't one, same as this
 * page's other real-data-only cards (HeadToHeadCard, MatchVerdictCard).
 *
 * Reuses predictionResultInfo — the exact result-formatting /predictions/mine
 * already established (moved to src/lib/predictions.ts so the two share one
 * definition) — rather than a second, possibly-drifting copy of what
 * "correct"/"incorrect"/"not scored yet" means.
 */
export function YourPredictionCard({ predictedOutcome, pointsAwarded, status }: YourPredictionCardProps) {
  const result = predictionResultInfo(status, pointsAwarded);
  const ResultIcon = result.icon;
  // "Pending" (predictionResultInfo's fallback for a still-open fixture) adds
  // nothing beyond what "You predicted: Home win" already implies pre-
  // kickoff — only show the second line once there's real, more specific
  // information to add (scored, or a genuine no-result state).
  const showResultLine = pointsAwarded !== null || status === "finished" || status === "postponed" || status === "cancelled" || status === "abandoned";

  return (
    <div className="kivo-glass flex items-center gap-3 rounded-2xl p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-kivo-cyan/10">
        <Target className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">
          You predicted <span className="font-semibold">{PREDICTION_OUTCOME_LABEL[predictedOutcome]}</span>
        </p>
        {showResultLine && (
          <p className={`flex items-center gap-1 text-xs ${result.className}`}>
            <ResultIcon className="h-3 w-3 shrink-0" strokeWidth={2} />
            {result.label}
          </p>
        )}
      </div>
      <Link
        href="/predictions/mine"
        className="shrink-0 text-[11px] text-foreground-subtle transition hover:text-kivo-cyan"
      >
        My predictions
      </Link>
    </div>
  );
}
