import Link from "next/link";
import { Target } from "lucide-react";
import {
  PREDICTION_TYPE_LABEL,
  describePredictionPick,
  predictionResultInfo,
  type PredictionPick,
  type PredictionResolution,
} from "@/lib/predictions";
import type { FixtureStatus } from "@/lib/football/fixture-status";

export type YourPredictionRow = {
  id: string;
  pick: PredictionPick;
  /** Joined from `players` by the caller — a prediction row only carries an id. */
  playerName: string | null;
  pointsAwarded: number | null;
  resolution: PredictionResolution | null;
  unresolvableReason: string | null;
};

type YourPredictionCardProps = {
  predictions: YourPredictionRow[];
  status: FixtureStatus;
};

/**
 * RECOMMENDATIONS.md item 293: `predictions.fixture_id` and this page's own
 * `fixture.id` are the identical real foreign key, but Match Centre never
 * joined them — a user who picked "Home win" on /predictions got no
 * acknowledgment of that pick anywhere on the match they picked it for.
 * MatchCentrePage queries the caller's own predictions for this exact fixture
 * (predictions_select_own already scopes this to their own rows — no RLS
 * change) and renders nothing at all when there aren't any, same as this
 * page's other real-data-only cards (HeadToHeadCard, MatchVerdictCard).
 *
 * Now a list rather than a single line, because a fixture carries up to six
 * predictions from one person — one per type. Each row names its own type,
 * and **nothing here is ever derived**: a correct-score pick of 2-1 is shown
 * as "Correct score: 2-1" and never as "you predicted a home win", because
 * the user did not predict a home win. They predicted a scoreline that
 * happens to imply one, and presenting an implication as their own pick is
 * exactly the kind of small fabrication this product refuses.
 *
 * Reuses predictionResultInfo — the exact result-formatting /predictions/mine
 * already established (in src/lib/predictions.ts so the surfaces share one
 * definition) — including its "unresolvable" state, which reads as a
 * warning-toned explanation rather than as a miss.
 */
export function YourPredictionCard({ predictions, status }: YourPredictionCardProps) {
  if (predictions.length === 0) return null;

  return (
    <div className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-kivo-cyan/10">
            <Target className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
          </span>
          <p className="truncate text-sm font-semibold text-foreground">
            {predictions.length === 1 ? "Your prediction" : `Your ${predictions.length} predictions`}
          </p>
        </div>
        <Link
          href="/predictions/mine"
          className="kivo-focus shrink-0 text-[11px] text-foreground-subtle transition hover:text-kivo-cyan"
        >
          My predictions
        </Link>
      </div>

      <ul className="flex flex-col">
        {predictions.map((prediction, index) => {
          const result = predictionResultInfo(
            status,
            prediction.pointsAwarded,
            prediction.resolution,
            prediction.unresolvableReason,
          );
          const ResultIcon = result.icon;
          // "Pending" adds nothing before kickoff beyond what the pick itself
          // already says — only show a second line once there is genuinely
          // more specific information (scored, unresolvable, or a real
          // no-result state).
          const showResultLine =
            prediction.pointsAwarded !== null ||
            prediction.resolution === "unresolvable" ||
            status === "finished" ||
            status === "postponed" ||
            status === "cancelled" ||
            status === "abandoned";

          return (
            <li
              key={prediction.id}
              className={`flex flex-col gap-0.5 py-3 ${index > 0 ? "border-t border-hairline-soft" : "pt-0"}`}
            >
              <p className="text-sm text-foreground">
                <span className="text-foreground-subtle">{PREDICTION_TYPE_LABEL[prediction.pick.type]}: </span>
                <span className="font-semibold">
                  {describePredictionPick(prediction.pick, prediction.playerName)}
                </span>
              </p>
              {showResultLine && (
                <p className={`flex items-start gap-1 text-xs ${result.className}`}>
                  <ResultIcon className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2} />
                  <span>{result.label}</span>
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
