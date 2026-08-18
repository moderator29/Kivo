import Link from "next/link";
import { Trophy } from "lucide-react";
import { HowScoringWorks } from "./how-scoring-works";

export type LeaderboardEntry = {
  teamId: string;
  teamName: string;
  ownerUsername: string;
  totalPoints: number;
  hasScores: boolean;
};

export function FantasyLeaderboard({
  entries,
  hasAnyScores,
  activeTeamId,
}: {
  entries: LeaderboardEntry[];
  hasAnyScores: boolean;
  activeTeamId: string;
}) {
  if (!hasAnyScores) {
    return (
      <div className="flex flex-col gap-3">
        <div className="kivo-glass-brand flex flex-col items-center gap-2 rounded-2xl p-8 text-center">
          <Trophy className="h-6 w-6 text-foreground-subtle" strokeWidth={1.5} />
          <p className="text-sm text-foreground-muted">No gameweeks scored yet.</p>
          <p className="max-w-xs text-xs text-foreground-subtle">
            Standings will appear here once a gameweek finishes and points are calculated.
          </p>
        </div>
        <HowScoringWorks />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="kivo-glass-brand flex flex-col gap-1 rounded-2xl p-4">
        <h2 className="px-1 pb-2 text-sm font-semibold text-foreground">League standings</h2>
        <div className="flex flex-col divide-y divide-hairline-soft">
          {entries.map((entry, index) => {
            const isViewer = entry.teamId === activeTeamId;
            return (
              <div
                key={entry.teamId}
                className={`flex items-center gap-3 px-2 py-2.5 ${
                  isViewer ? "rounded-xl bg-accent/10 ring-1 ring-accent/30" : ""
                }`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ring-1 ${
                    index === 0
                      ? "bg-achievement/15 text-achievement ring-achievement/30"
                      : "bg-surface-2 text-foreground-subtle ring-hairline"
                  }`}
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                    <span className="truncate">{entry.teamName}</span>
                    {isViewer && (
                      <span className="shrink-0 rounded-full bg-accent/20 px-1.5 py-0.5 text-[11px] font-semibold text-accent">
                        You
                      </span>
                    )}
                  </p>
                  <Link
                    href={`/u/${entry.ownerUsername}`}
                    className="block truncate text-xs text-foreground-subtle hover:text-accent"
                  >
                    @{entry.ownerUsername}
                  </Link>
                </div>
                <span className="shrink-0 text-base font-bold tabular-nums text-foreground">
                  {entry.hasScores ? entry.totalPoints : "-"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <HowScoringWorks />
    </div>
  );
}
