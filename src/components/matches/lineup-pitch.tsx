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
export function LineupPitch({
  formation,
  rows,
  viewerFantasyRoster,
}: {
  formation: string | null;
  rows: PitchRow[];
  /** RECOMMENDATIONS.md item 294: playerId -> isCaptain, for the real
   * starters who are also starting in the viewer's own current fantasy XI
   * for this fixture's season. Optional so lineup-pitch.tsx has no hard
   * dependency on the fantasy cross-reference — omitted entirely for a
   * guest or a viewer with no matching fantasy team. */
  viewerFantasyRoster?: Map<string, boolean>;
}) {
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
              // RECOMMENDATIONS.md item 294: a real "In your XI" indicator —
              // a cyan ring around the shirt token plus a captain "C" badge
              // (pitch.tsx's own convention for the same real fact) rather
              // than a second full-text pill, since each token here only has
              // 60px to work with.
              const inViewerXI = viewerFantasyRoster?.has(p.playerId) ?? false;
              const isViewerCaptain = inViewerXI && Boolean(viewerFantasyRoster?.get(p.playerId));
              const token = (
                <>
                  <span className="relative flex h-9 w-9 items-center justify-center">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-full border text-xs font-semibold text-foreground transition group-hover:bg-white/10 group-hover:text-kivo-cyan ${
                        inViewerXI ? "border-kivo-cyan/60 bg-kivo-cyan/10 ring-2 ring-kivo-cyan/50" : "border-white/10 bg-white/[0.06]"
                      }`}
                    >
                      {p.shirtNumber ?? <UserRound className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />}
                    </span>
                    {isViewerCaptain && (
                      <span
                        title="Your captain"
                        aria-label="Your captain"
                        className="kivo-gradient-victory absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-kivo-white ring-2 ring-kivo-obsidian"
                      >
                        C
                      </span>
                    )}
                  </span>
                  <span className="w-full truncate text-center text-[11px] font-medium text-foreground group-hover:text-kivo-cyan">
                    {p.playerName}
                  </span>
                  {inViewerXI && <span className="sr-only">In your fantasy XI{isViewerCaptain ? ", your captain" : ""}</span>}
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
