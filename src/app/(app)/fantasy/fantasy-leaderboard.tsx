"use client";

import Link from "next/link";
import { Trophy } from "lucide-react";
import { motion } from "motion/react";
import { HowScoringWorks } from "./how-scoring-works";

const EASE = [0.22, 1, 0.36, 1] as const;

export type LeaderboardEntry = {
  teamId: string;
  teamName: string;
  ownerUsername: string;
  totalPoints: number;
  hasScores: boolean;
};

export type PointsByGameweekEntry = { gameweekNumber: number; points: number };

/**
 * RECOMMENDATIONS.md item 295: a real gameweek-by-gameweek arc for the
 * viewer's own team — every entry is a real fantasy_points row (written by
 * scoreFantasyGameweek), never a projection. Renders nothing when the viewer
 * has no scored gameweek yet (e.g. just joined a league other teams already
 * have history in) — same "nothing below a real floor" convention as this
 * file's own no-scores empty state below.
 */
function PointsByGameweekStrip({ pointsHistory }: { pointsHistory: PointsByGameweekEntry[] }) {
  if (pointsHistory.length === 0) return null;

  const maxPoints = Math.max(1, ...pointsHistory.map((gw) => Math.abs(gw.points)));

  return (
    <div className="kivo-glass flex flex-col gap-3 rounded-2xl p-4">
      <h2 className="px-1 text-sm font-semibold text-foreground">Your points by gameweek</h2>
      <div className="kivo-scroll-fade-x flex items-end gap-2.5 overflow-x-auto px-1 pb-1">
        {pointsHistory.map((gw, index) => {
          const barHeightPct = Math.max(8, Math.round((Math.abs(gw.points) / maxPoints) * 100));
          return (
            <motion.div
              key={gw.gameweekNumber}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: index * 0.02, ease: EASE }}
              className="flex w-8 shrink-0 flex-col items-center gap-1"
            >
              <span className="text-[11px] font-semibold tabular-nums text-foreground">{gw.points}</span>
              <div className="flex h-16 w-full items-end overflow-hidden rounded-md bg-white/[0.05]">
                <div
                  className={`w-full rounded-md ${gw.points < 0 ? "bg-critical/60" : "kivo-gradient-prime"}`}
                  style={{ height: `${barHeightPct}%` }}
                />
              </div>
              <span className="text-[10px] text-foreground-subtle">GW{gw.gameweekNumber}</span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export function FantasyLeaderboard({
  entries,
  hasAnyScores,
  activeTeamId,
  pointsHistory,
}: {
  entries: LeaderboardEntry[];
  hasAnyScores: boolean;
  activeTeamId: string;
  pointsHistory: PointsByGameweekEntry[];
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

  // Competition-style ranking: two teams tied on totalPoints share a rank
  // (e.g. 1, 1, 3) instead of getting consecutive numbers, and the gold
  // "achievement" ring is gated on the computed rank being 1 rather than on
  // literal row position — so a genuine tie for first shows gold on both
  // rows, not just whichever happened to sort first.
  const ranks = entries.map((entry, index) => {
    if (index === 0) return 1;
    const prev = entries[index - 1];
    const tied = entry.hasScores && prev.hasScores && entry.totalPoints === prev.totalPoints;
    return tied ? -1 : index + 1; // -1 is a placeholder, resolved below
  });
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] === -1) ranks[i] = ranks[i - 1];
  }

  return (
    <div className="flex flex-col gap-3">
      <PointsByGameweekStrip pointsHistory={pointsHistory} />
      <div className="kivo-glass-brand flex flex-col gap-1 rounded-2xl p-4">
        <h2 className="px-1 pb-2 text-sm font-semibold text-foreground">League standings</h2>
        <div className="flex flex-col divide-y divide-hairline-soft">
          {entries.map((entry, index) => {
            const isViewer = entry.teamId === activeTeamId;
            const rank = ranks[index];
            return (
              <motion.div
                key={entry.teamId}
                layout
                transition={{ duration: 0.35, ease: EASE }}
                className={`flex items-center gap-3 px-2 py-2.5 ${
                  isViewer ? "rounded-xl bg-accent/10 ring-1 ring-accent/30" : ""
                }`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ring-1 ${
                    rank === 1
                      ? "bg-achievement/15 text-achievement ring-achievement/30"
                      : "bg-surface-2 text-foreground-subtle ring-hairline"
                  }`}
                >
                  {rank}
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
              </motion.div>
            );
          })}
        </div>
      </div>
      <HowScoringWorks />
    </div>
  );
}
