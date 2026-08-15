import type { PositionalObservation } from "./positional-types";

/**
 * KIVO Heatmap Engine — turns a set of real `PositionalObservation`s into a
 * density grid on a canonical pitch coordinate system. KIVO owns this
 * visualization layer; the positional data itself must come from a real,
 * connected `PositionalDataProvider` (`positional-types.ts`). None is
 * connected today, so in production this engine always receives an empty
 * `observations` array right now — that is the correct, expected state
 * (see `docs/HEATMAP_ENGINE.md`), not a bug to special-case around. Pure and
 * DB/UI-framework-free so it's trivially unit-testable and reusable from any
 * future consumer (player heatmap, team heatmap, a future admin QA view).
 *
 * Zero import from or reference to `premium-stats.ts` or any Sportmonks-tied
 * code — this is a clean-room, provider-agnostic implementation.
 */

/**
 * Canonical normalized pitch coordinate system every `PositionalObservation`
 * is expected to already be reported in. Deliberately matches the viewBox
 * `PitchLines` (`src/app/(app)/fantasy/pitch.tsx`, reused by
 * `LineupPitch`/`HeatmapView`) already draws at — `0 0 100 140` — so a
 * heatmap grid built from this engine overlays that exact same pitch
 * graphic with no coordinate transform needed.
 */
export const PITCH_DIMENSIONS = { width: 100, height: 140 } as const;

export const DEFAULT_GRID_COLS = 6;
export const DEFAULT_GRID_ROWS = 7;

export type HeatmapZone = {
  col: number;
  row: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Raw observation count that landed in this zone. */
  count: number;
  /** `count` normalized against the grid's busiest zone — 0 when there are
   * no observations anywhere, 1 for the single busiest zone. */
  density: number;
};

export type HeatmapGrid = {
  cols: number;
  rows: number;
  zones: HeatmapZone[];
  totalObservations: number;
  maxZoneCount: number;
};

export type HeatmapScope = {
  playerId?: string;
  matchId?: string;
};

export type HeatmapResult = {
  playerId: string | null;
  matchId: string | null;
  grid: HeatmapGrid;
  /** False whenever zero observations contributed to this grid — the
   * correct value today for every real call site, since no positional
   * provider is connected. Consumers must check this before rendering a
   * heatmap and show the "unavailable" empty state instead when it's
   * false — never render an all-zero grid as if it were a real (if boring)
   * heatmap. */
  hasData: boolean;
  /** Distinct `source` values that contributed at least one observation —
   * for attribution/debugging once a real provider exists. */
  sourcesUsed: string[];
};

export class HeatmapEngine {
  private readonly cols: number;
  private readonly rows: number;

  constructor(cols: number = DEFAULT_GRID_COLS, rows: number = DEFAULT_GRID_ROWS) {
    this.cols = cols;
    this.rows = rows;
  }

  /**
   * Builds a density grid from `observations`. `scope` is echoed back onto
   * the result for the caller's convenience (e.g. rendering a caption) — it
   * does not filter `observations`; callers pass in an already-scoped array
   * (e.g. only this player's observations for this match), same convention
   * as `form-engine.ts` and `rating-engine.ts` taking pre-scoped inputs.
   */
  build(observations: PositionalObservation[], scope: HeatmapScope = {}): HeatmapResult {
    const cellWidth = PITCH_DIMENSIONS.width / this.cols;
    const cellHeight = PITCH_DIMENSIONS.height / this.rows;

    const zones: HeatmapZone[] = [];
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        zones.push({
          col,
          row,
          x0: col * cellWidth,
          x1: (col + 1) * cellWidth,
          y0: row * cellHeight,
          y1: (row + 1) * cellHeight,
          count: 0,
          density: 0,
        });
      }
    }

    const sources = new Set<string>();
    let totalObservations = 0;

    for (const obs of observations) {
      // Out-of-bounds observations are skipped, not clamped into the
      // nearest edge zone — clamping would misrepresent a coordinate the
      // provider itself reported outside the canonical pitch as if it were
      // a real edge-of-pitch touch.
      if (obs.x < 0 || obs.x > PITCH_DIMENSIONS.width || obs.y < 0 || obs.y > PITCH_DIMENSIONS.height) continue;

      const col = Math.min(this.cols - 1, Math.floor(obs.x / cellWidth));
      const row = Math.min(this.rows - 1, Math.floor(obs.y / cellHeight));
      const zone = zones[row * this.cols + col];
      zone.count += 1;
      totalObservations += 1;
      sources.add(obs.source);
    }

    const maxZoneCount = zones.reduce((max, zone) => Math.max(max, zone.count), 0);
    if (maxZoneCount > 0) {
      for (const zone of zones) zone.density = zone.count / maxZoneCount;
    }

    return {
      playerId: scope.playerId ?? null,
      matchId: scope.matchId ?? null,
      grid: { cols: this.cols, rows: this.rows, zones, totalObservations, maxZoneCount },
      hasData: totalObservations > 0,
      sourcesUsed: Array.from(sources),
    };
  }
}
