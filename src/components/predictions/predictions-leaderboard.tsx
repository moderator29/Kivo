"use client";

import Link from "next/link";
import { Trophy } from "lucide-react";
import { motion } from "motion/react";
import { CORRECT_PREDICTION_POINTS } from "@/lib/predictions";

const EASE = [0.22, 1, 0.36, 1] as const;

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
          <Trophy className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
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
              <motion.li
                key={entry.profileId}
                layout
                transition={{ duration: 0.35, ease: EASE }}
                className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 ${
                  isViewer ? "bg-white/[0.08]" : ""
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="w-5 shrink-0 text-right text-sm font-semibold text-foreground-subtle">{rank}</span>
                  {entry.username ? (
                    <Link
                      href={`/u/${entry.username}`}
                      className="truncate text-sm font-medium text-foreground hover:text-kivo-cyan"
                    >
                      {entry.name}
                      {isViewer && <span className="ml-1.5 text-xs font-normal text-kivo-cyan">(you)</span>}
                    </Link>
                  ) : (
                    <span className="truncate text-sm font-medium text-foreground">
                      {entry.name}
                      {isViewer && <span className="ml-1.5 text-xs font-normal text-kivo-cyan">(you)</span>}
                    </span>
                  )}
                </div>
                <span className="shrink-0 text-sm font-semibold text-foreground">{entry.points} pts</span>
              </motion.li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
