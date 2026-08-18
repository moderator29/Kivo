import Link from "next/link";
import { Trophy } from "lucide-react";
import { CORRECT_PREDICTION_POINTS } from "@/lib/predictions";

export interface LeaderboardEntry {
  profileId: string;
  name: string;
  username: string | null;
  points: number;
}

export function PredictionsLeaderboard({
  entries,
  viewerProfileId,
}: {
  entries: LeaderboardEntry[];
  viewerProfileId: string | null;
}) {
  return (
    <div className="kivo-glass-brand flex flex-col gap-4 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-accent" strokeWidth={1.75} />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Leaderboard</h2>
        </div>
        <span className="text-xs text-foreground-subtle">{CORRECT_PREDICTION_POINTS} pts per correct pick</span>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-foreground-muted">
          No predictions have been scored yet. Once fixtures finish and results are graded, the top predictors will
          show up here.
        </p>
      ) : (
        <ol className="flex flex-col gap-1">
          {entries.map((entry, index) => {
            const rank = index + 1;
            const isViewer = viewerProfileId !== null && entry.profileId === viewerProfileId;
            return (
              <li
                key={entry.profileId}
                className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 ${
                  isViewer ? "bg-accent-soft" : ""
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-5 shrink-0 text-right text-sm font-semibold text-foreground-subtle">{rank}</span>
                  {entry.username ? (
                    <Link
                      href={`/u/${entry.username}`}
                      className="truncate text-sm font-medium text-foreground hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                    >
                      {entry.name}
                      {isViewer && <span className="ml-1.5 text-xs font-normal text-accent">(you)</span>}
                    </Link>
                  ) : (
                    <span className="truncate text-sm font-medium text-foreground">
                      {entry.name}
                      {isViewer && <span className="ml-1.5 text-xs font-normal text-accent">(you)</span>}
                    </span>
                  )}
                </div>
                <span className="shrink-0 text-sm font-semibold text-foreground">{entry.points} pts</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
