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
      <div className="kivo-glass-brand flex flex-col gap-1 rounded-2xl p-4">
        <h2 className="px-1 pb-2 text-sm font-semibold text-foreground">League standings</h2>
        <div className="flex flex-col divide-y divide-white/5">
          {entries.map((entry, index) => {
            const isViewer = entry.teamId === activeTeamId;
            const rank = ranks[index];
            return (
              <motion.div
                key={entry.teamId}
                layout
                transition={{ duration: 0.35, ease: EASE }}
                className={`flex items-center gap-3 px-2 py-2.5 ${
                  isViewer ? "rounded-xl bg-kivo-cyan/10 ring-1 ring-kivo-cyan/30" : ""
                }`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ring-1 ${
                    rank === 1
                      ? "bg-achievement/15 text-achievement ring-achievement/30"
                      : "bg-white/[0.06] text-foreground-subtle ring-white/10"
                  }`}
                >
                  {rank}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
                    <span className="truncate">{entry.teamName}</span>
                    {isViewer && (
                      <span className="shrink-0 rounded-full bg-kivo-cyan/20 px-1.5 py-0.5 text-[11px] font-semibold text-kivo-cyan">
                        You
                      </span>
                    )}
                  </p>
                  <Link
                    href={`/u/${entry.ownerUsername}`}
                    className="block truncate text-xs text-foreground-subtle hover:text-kivo-cyan"
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
