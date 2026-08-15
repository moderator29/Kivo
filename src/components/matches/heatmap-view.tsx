"use client";

import { Radar } from "lucide-react";
import { PitchLines } from "@/app/(app)/fantasy/pitch";
import { HeatmapEngine, PITCH_DIMENSIONS } from "@/lib/football/heatmap-engine";
import type { PositionalObservation } from "@/lib/football/positional-types";

const engine = new HeatmapEngine();

export type HeatmapViewProps = {
  /** Already-scoped real observations for whatever this heatmap is of (one
   * player in one match, or a whole team) — always empty in production
   * today, since no `PositionalDataProvider` is connected yet
   * (`positional-types.ts`). That renders the "unavailable" state below,
   * which is the correct, expected behaviour right now, not an error case
   * to work around. */
  observations: PositionalObservation[];
  playerId?: string;
  matchId?: string;
  /** What this heatmap is of, in words — e.g. a player's display name or
   * "Home team" — used in the empty-state copy and the data caption. Kept
   * generic so this component has no opinion on player-vs-team. */
  subjectLabel: string;
};

/**
 * KIVO's own heatmap visualization, built on `HeatmapEngine`. Reuses
 * `PitchLines` (`src/app/(app)/fantasy/pitch.tsx`) for the pitch background —
 * the same visual language `LineupPitch` already established for match
 * pitch graphics — rather than drawing a second pitch graphic. Renders a
 * real density grid when `observations` has real data, and otherwise a
 * deliberate, polished "Positional data unavailable for this match" empty
 * state: this is expected to be the only state real users see until a real
 * positional-data vendor is connected, so it's designed to look complete
 * and intentional, not like a broken or missing feature.
 */
export function HeatmapView({ observations, playerId, matchId, subjectLabel }: HeatmapViewProps) {
  const result = engine.build(observations, { playerId, matchId });

  if (!result.hasData) {
    return (
      <div className="kivo-glass relative flex flex-col items-center gap-3 overflow-hidden rounded-2xl p-8 text-center">
        <PitchLines />
        <div className="relative flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.04]">
          <Radar className="h-6 w-6 text-foreground-subtle" strokeWidth={1.5} />
        </div>
        <div className="relative flex flex-col gap-1.5">
          <p className="text-sm font-medium text-foreground">Positional data unavailable for this match</p>
          <p className="max-w-xs text-xs leading-relaxed text-foreground-subtle">
            KIVO doesn&apos;t have a connected positional data provider yet, so {subjectLabel}&apos;s on-pitch movement
            can&apos;t be shown here. This is expected today, not a bug — a heatmap will appear automatically once
            real touch data is available for this match.
          </p>
        </div>
      </div>
    );
  }

  const { grid } = result;
  const cellWidth = PITCH_DIMENSIONS.width / grid.cols;
  const cellHeight = PITCH_DIMENSIONS.height / grid.rows;

  return (
    <div className="kivo-glass relative flex flex-col gap-3 overflow-hidden rounded-2xl p-4">
      <PitchLines />
      <svg
        className="relative"
        viewBox={`0 0 ${PITCH_DIMENSIONS.width} ${PITCH_DIMENSIONS.height}`}
        preserveAspectRatio="none"
        style={{ width: "100%", aspectRatio: `${PITCH_DIMENSIONS.width} / ${PITCH_DIMENSIONS.height}` }}
        role="img"
        aria-label={`Heatmap for ${subjectLabel}`}
      >
        {grid.zones.map((zone) => (
          <rect
            key={`${zone.col}-${zone.row}`}
            x={zone.col * cellWidth}
            y={zone.row * cellHeight}
            width={cellWidth}
            height={cellHeight}
            fill="var(--kivo-cyan)"
            fillOpacity={zone.density * 0.7}
          />
        ))}
      </svg>
      <p className="relative text-center text-[11px] text-foreground-subtle">
        {subjectLabel} · {grid.totalObservations} positional observation{grid.totalObservations === 1 ? "" : "s"}
      </p>
    </div>
  );
}
