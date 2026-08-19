/**
 * `HeatmapAggregator` — the fourth of the five services. It turns an anchor and
 * a set of normalized actions into a zone grid, and it tags every grid it
 * produces with how that grid came to exist.
 *
 * ## Two paths, and they never mix
 *
 * **Tracked.** If any action carries a real coordinate, only the coordinate-
 * carrying actions are used, they are binned by where they actually happened,
 * and the result is tagged `"tracked"`. No anchor is consulted; nothing is
 * inferred. This is the path a real `PositionalDataProvider` would light up,
 * and nothing implements that interface today.
 *
 * **Derived.** Otherwise the grid is built from the anchor plus the mix of
 * action classes, and tagged `"derived"`. The tag is not optional and not
 * separable from the grid — it is a field on the same object, so there is no
 * way for a consumer to render the shape without also holding the statement of
 * what it is.
 *
 * Mixing a real coordinate with a derived spread in one grid would produce
 * something no reader could interpret, so the tracked path wins outright
 * whenever any real coordinate exists.
 *
 * ## What the derived model actually claims
 *
 * It claims exactly three things, each traceable to a real input:
 *
 *   1. This player lined up here (the anchor — from the team sheet).
 *   2. Their involvement leaned defensive / attacking / neither (the class mix
 *      — from real counted actions).
 *   3. KIVO does not know their lateral position, or knows only that they were
 *      wide on one side without knowing which (from `lateralConfidence`).
 *
 * Point 3 is why lateral spread widens rather than sharpens as confidence
 * drops. A heatmap that looks precise about something KIVO cannot see is worse
 * than a diffuse one, because only the diffuse one is legible as uncertainty.
 *
 * It claims nothing about time, distance covered, or where any individual
 * action happened. Those are not in the inputs and are not in the output.
 */

import { DEFAULT_GRID_COLS, DEFAULT_GRID_ROWS } from "../heatmap-engine";
import { NORMALIZED_PITCH } from "./pitch-coordinates";
import type { MatchPeriod, NormalizedPitchAction, PitchActionClass } from "./event-normalizer";
import type { PositionAnchor } from "./player-position-mapper";

/** One cell of an activity grid, in canonical pitch coordinates. */
export type ActivityZone = {
  col: number;
  row: number;
  /** Canonical-space bounds (0-100 both axes). */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /**
   * Accumulated activity for this zone. On the tracked path this is a real
   * count of observations. On the derived path it is a weight in arbitrary
   * units with no meaning outside this grid — which is why the UI is given
   * `totalActions` (a real integer count of real actions) to display, and never
   * this number.
   */
  weight: number;
  /** `weight` against the busiest zone: 0 when the grid is empty, 1 at the peak. */
  density: number;
};

export type ActivityGrid = {
  cols: number;
  rows: number;
  zones: ActivityZone[];
  maxZoneWeight: number;
};

/** How a grid came to exist. Never inferred by a consumer — always read off the
 * result. */
export type HeatmapDerivation =
  /** Built from real positional coordinates reported by a provider. */
  | "tracked"
  /** Built from a formation anchor and counted actions. An inference. */
  | "derived";

export type AggregatedHeatmap = {
  grid: ActivityGrid;
  derivation: HeatmapDerivation;
  /** True when there is genuinely something to draw. */
  hasData: boolean;
  /**
   * The real, integer number of real actions behind this grid — timeline events
   * counted once each, statistics counted by their reported value. This is the
   * only number about volume the UI is allowed to show.
   */
  totalActions: number;
  /** Which action classes contributed, in descending order of weight. Lets the
   * UI say what the shape is actually made of. */
  classMix: { actionClass: PitchActionClass; weight: number }[];
  /** Distinct `source` values that contributed. */
  sourcesUsed: string[];
  /**
   * Actions excluded by the period filter because they carry no period at all
   * (match-total statistics — see `EventNormalizer`). Non-zero means the view
   * the reader is looking at is narrower than the data KIVO holds, and the UI
   * must say so rather than let a half-match view look complete.
   */
  actionsWithoutPeriod: number;
};

export type AggregateOptions = {
  /** Restrict to one period. Omitted or "full-match" includes everything. */
  period?: MatchPeriod | "full-match";
  cols?: number;
  rows?: number;
};

/**
 * How far, in canonical pitch units, each action class pulls a derived shape
 * away from the player's formation slot along the depth axis.
 *
 * These are intentionally modest. A defender who made a lot of interceptions
 * did not play in their own six-yard box; they played slightly deeper than
 * their slot. A number large enough to move a player between lines would be
 * asserting a positional change the data does not support.
 */
const CLASS_DEPTH_OFFSET: Record<PitchActionClass, number> = {
  goalkeeping: -10,
  defensive: -12,
  buildUp: 0,
  attacking: 12,
  // A foul or a card says nothing about depth beyond "they were involved".
  discipline: 0,
  unclassified: 0,
};

/**
 * Spread of the kernel each class contributes, in canonical units.
 *
 * Depth spread is narrow enough that a player's line stays legible. Lateral
 * spread depends entirely on what the mapper knew: with a formation column it
 * is a channel, without one it is most of the pitch — which is the visual form
 * of "KIVO does not know".
 */
const DEPTH_SIGMA = 13;
const LATERAL_SIGMA_WITH_COLUMN = 16;
const LATERAL_SIGMA_WITHOUT_COLUMN = 34;

/**
 * Weight given to simply having been on the pitch, spread on the anchor itself.
 *
 * Without it, a player with one recorded action would render as a single hot
 * cell — a confident claim built on one event. With it, the base presence at
 * the formation slot dominates until enough real actions accumulate to shift
 * it, which is the correct relationship between evidence and confidence.
 */
const PRESENCE_WEIGHT = 24;

function gaussian(distance: number, sigma: number): number {
  return Math.exp(-(distance * distance) / (2 * sigma * sigma));
}

function buildEmptyZones(cols: number, rows: number): ActivityZone[] {
  const cellWidth = NORMALIZED_PITCH.width / cols;
  const cellHeight = NORMALIZED_PITCH.height / rows;
  const zones: ActivityZone[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      zones.push({
        col,
        row,
        x0: col * cellWidth,
        x1: (col + 1) * cellWidth,
        // Canonical y grows towards the goal being attacked, so row 0 is the
        // deepest band. The render layer (`toRenderSpace`) is what flips this
        // for the screen; nothing here knows or cares which way up it is drawn.
        y0: row * cellHeight,
        y1: (row + 1) * cellHeight,
        weight: 0,
        density: 0,
      });
    }
  }
  return zones;
}

function finalize(zones: ActivityZone[], cols: number, rows: number): ActivityGrid {
  let maxZoneWeight = 0;
  for (const zone of zones) if (zone.weight > maxZoneWeight) maxZoneWeight = zone.weight;
  if (maxZoneWeight > 0) {
    for (const zone of zones) zone.density = zone.weight / maxZoneWeight;
  }
  return { cols, rows, zones, maxZoneWeight };
}

export class HeatmapAggregator {
  /**
   * Builds one player's grid.
   *
   * `actions` must already be scoped to that player — same convention as
   * `HeatmapEngine.build`, `form-engine.ts` and `rating-engine.ts`, all of
   * which take pre-scoped inputs rather than filtering internally.
   */
  aggregate(
    actions: readonly NormalizedPitchAction[],
    anchor: PositionAnchor | null,
    options: AggregateOptions = {},
  ): AggregatedHeatmap {
    const cols = options.cols ?? DEFAULT_GRID_COLS;
    const rows = options.rows ?? DEFAULT_GRID_ROWS;
    const period = options.period ?? "full-match";

    // The period filter runs first, and counts what it dropped for lack of a
    // period rather than for being in the wrong one — those are different
    // facts, and only the first one means the reader is seeing less than KIVO
    // knows.
    let actionsWithoutPeriod = 0;
    const scoped: NormalizedPitchAction[] = [];
    for (const action of actions) {
      if (period === "full-match") {
        scoped.push(action);
        continue;
      }
      if (action.period === null) {
        actionsWithoutPeriod += 1;
        continue;
      }
      if (action.period === period) scoped.push(action);
    }

    const tracked = scoped.filter((a) => a.coordinate !== null);
    const zones = buildEmptyZones(cols, rows);
    const sources = new Set<string>();
    const classWeights = new Map<PitchActionClass, number>();
    let totalActions = 0;

    const noteAction = (action: NormalizedPitchAction) => {
      sources.add(action.source);
      classWeights.set(action.actionClass, (classWeights.get(action.actionClass) ?? 0) + action.weight);
      totalActions += action.weight;
    };

    const summarise = (derivation: HeatmapDerivation, hasData: boolean): AggregatedHeatmap => ({
      grid: finalize(zones, cols, rows),
      derivation,
      hasData,
      totalActions: Math.round(totalActions),
      classMix: Array.from(classWeights.entries())
        .map(([actionClass, weight]) => ({ actionClass, weight }))
        .sort((a, b) => b.weight - a.weight),
      sourcesUsed: Array.from(sources),
      actionsWithoutPeriod,
    });

    // ---- Tracked path -----------------------------------------------------
    if (tracked.length > 0) {
      const cellWidth = NORMALIZED_PITCH.width / cols;
      const cellHeight = NORMALIZED_PITCH.height / rows;
      for (const action of tracked) {
        const point = action.coordinate!;
        const col = Math.min(cols - 1, Math.floor(point.x / cellWidth));
        const row = Math.min(rows - 1, Math.floor(point.y / cellHeight));
        zones[row * cols + col].weight += action.weight;
        noteAction(action);
      }
      return summarise("tracked", true);
    }

    // ---- Derived path -----------------------------------------------------
    // No anchor means no basis. An empty grid is returned rather than a
    // centre-of-pitch blob, and `hasData: false` is the signal the caller acts
    // on — the same contract `HeatmapEngine` already established.
    if (!anchor) {
      for (const action of scoped) noteAction(action);
      return summarise("derived", false);
    }

    const lateralSigma =
      anchor.lateralConfidence === "provider-order" ? LATERAL_SIGMA_WITH_COLUMN : LATERAL_SIGMA_WITHOUT_COLUMN;

    // Every contribution is a kernel centred somewhere on the depth axis
    // relative to the anchor. `PRESENCE_WEIGHT` at the anchor itself is the
    // floor; each class of real action adds its own weighted kernel.
    const contributions: { x: number; y: number; weight: number }[] = [
      { x: anchor.coordinate.x, y: anchor.coordinate.y, weight: PRESENCE_WEIGHT },
    ];

    for (const action of scoped) {
      noteAction(action);
      const offset = CLASS_DEPTH_OFFSET[action.actionClass];
      contributions.push({
        x: anchor.coordinate.x,
        y: Math.min(NORMALIZED_PITCH.height, Math.max(0, anchor.coordinate.y + offset)),
        weight: action.weight,
      });
    }

    for (const zone of zones) {
      const centreX = (zone.x0 + zone.x1) / 2;
      const centreY = (zone.y0 + zone.y1) / 2;
      let weight = 0;
      for (const contribution of contributions) {
        weight +=
          contribution.weight *
          gaussian(centreX - contribution.x, lateralSigma) *
          gaussian(centreY - contribution.y, DEPTH_SIGMA);
      }
      zone.weight = weight;
    }

    return summarise("derived", true);
  }
}
