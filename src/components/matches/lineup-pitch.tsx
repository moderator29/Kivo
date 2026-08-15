"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { UserRound } from "lucide-react";
import { PitchLines } from "@/app/(app)/fantasy/pitch";
import { staggerDelay } from "@/lib/stagger";

export type PitchStarter = {
  playerId: string;
  playerName: string;
  shirtNumber: number | null;
  position: string | null;
};

const ROW_ORDER = ["F", "M", "D", "G"] as const;
type RowKey = (typeof ROW_ORDER)[number];

export type PitchRow = { key: RowKey; players: PitchStarter[] };

/**
 * Buckets a Starting XI into pitch rows using each player's real synced
 * `position` letter from the provider's /fixtures/lineups response
 * (NormalizedLineupEntry.position — API-Football returns "G"/"D"/"M"/"F"
 * per starter). Returns null — meaning "render the plain list instead" —
 * whenever the data isn't clean enough to draw a real, non-fabricated
 * pitch: fewer/more than 11 starters, a position that isn't one of the
 * four letters, or anything but exactly one goalkeeper. This never guesses
 * a missing player's position or a formation shape that isn't backed by
 * real per-player data.
 */
export function buildPitchRows(starters: PitchStarter[]): PitchRow[] | null {
  if (starters.length !== 11) return null;

  const buckets: Record<RowKey, PitchStarter[]> = { G: [], D: [], M: [], F: [] };
  for (const p of starters) {
    const letter = (p.position ?? "").trim().toUpperCase();
    if (letter !== "G" && letter !== "D" && letter !== "M" && letter !== "F") return null;
    buckets[letter as RowKey].push(p);
  }
  if (buckets.G.length !== 1) return null;

  return ROW_ORDER.map((key) => ({ key, players: buckets[key] })).filter((row) => row.players.length > 0);
}

/**
 * Visual language matches the fantasy squad builder's pitch (src/app/(app)/
 * fantasy/pitch.tsx, fantasy-builder.tsx): a `kivo-glass` card with the same
 * `PitchLines` markings, rows ordered attack-to-goalkeeper (top to bottom),
 * flex-wrap-centered player tokens. Reuses `PitchLines` directly rather than
 * redrawing it, per this task's "match that visual language" instruction.
 */
export function LineupPitch({ formation, rows }: { formation: string | null; rows: PitchRow[] }) {
  return (
    <div className="kivo-glass relative flex flex-col gap-4 overflow-hidden rounded-2xl p-4">
      <PitchLines />
      {formation && (
        <span className="relative self-center rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          {formation}
        </span>
      )}
      <div className="relative flex flex-col gap-4 py-1">
        {rows.map((row, rowIndex) => (
          <div key={row.key} className="flex flex-wrap items-start justify-center gap-3">
            {row.players.map((p, i) => {
              const token = (
                <>
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-xs font-semibold text-foreground transition group-hover:bg-white/10 group-hover:text-kivo-cyan">
                    {p.shirtNumber ?? <UserRound className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />}
                  </span>
                  <span className="w-full truncate text-center text-[11px] font-medium text-foreground group-hover:text-kivo-cyan">
                    {p.playerName}
                  </span>
                </>
              );
              return (
                <motion.div
                  key={p.playerId || p.playerName}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: staggerDelay(rowIndex * 4 + i, 0.03), ease: [0.22, 1, 0.36, 1] }}
                >
                  {p.playerId ? (
                    <Link href={`/players/${p.playerId}`} className="group flex w-[60px] flex-col items-center gap-1">
                      {token}
                    </Link>
                  ) : (
                    <div className="group flex w-[60px] flex-col items-center gap-1">{token}</div>
                  )}
                </motion.div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
