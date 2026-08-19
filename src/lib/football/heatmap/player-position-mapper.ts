/**
 * `PlayerPositionMapper` — the third of the five services, and the only place
 * in KIVO that turns "where a player lined up" into a coordinate.
 *
 * ## The two inputs, in order of how much they actually know
 *
 * **1. The provider's formation slot (`grid`).** API-Football publishes a
 * `"row:col"` string on every starter in `/fixtures/lineups`. Row 1 is the
 * goalkeeper's line and rows count upfield; column indexes the players within
 * that line. This is the closest thing to positional data the provider has, it
 * costs nothing extra (KIVO already makes that request for the lineup itself),
 * and it is a real statement by the competition's own team sheet.
 *
 * **2. The listed position letter.** G/D/M/F, or the longer words other feeds
 * use. This gives a depth band and says nothing at all about which channel a
 * player occupied.
 *
 * ## The uncertainty this module refuses to paper over
 *
 * Two things about the grid could not be verified in this build environment,
 * which cannot reach api-football.com:
 *
 *   * whether column 1 is the team's left or its right, and
 *   * whether the column count per row is stable enough to normalize against.
 *
 * The second is handled by taking the real observed maximum column in that row
 * from the lineup itself, so the mapping is self-calibrating against whatever
 * the provider actually sent rather than against an assumed formation width.
 *
 * The first cannot be resolved by arithmetic, so it is not resolved. It is
 * carried in the output as `lateralConfidence: "provider-order"` — meaning KIVO
 * knows this player was on one flank and does not know which — and
 * `HeatmapAggregator` responds by spreading that player's activity laterally
 * rather than concentrating it on a side. A mirrored heatmap that looks precise
 * is worse than a wide one that is honest, because only the second one tells
 * the reader what KIVO actually knows.
 *
 * When a player has no grid at all, `lateralConfidence` is `"none"` and the
 * anchor sits on the centre line purely as a place to spread from — the
 * aggregator then uses the full pitch width, so nothing renders as if KIVO
 * believed the player played centrally.
 */

import { parsePitchGrid } from "../providers/normalizers";
import { clampToPitch, NORMALIZED_PITCH, type PitchCoordinate } from "./pitch-coordinates";

/** How much the mapper knows about a player's lateral (x) position. */
export type LateralConfidence =
  /** A formation column was reported, but which touchline column 1 sits
   * against is unverified — see this module's doc comment. */
  | "provider-order"
  /** No lateral information at all. */
  | "none";

/** How much the mapper knows about a player's depth (y) position. */
export type DepthConfidence =
  /** From the provider's own formation row. */
  | "formation-slot"
  /** From the listed position letter only — a band, not a line. */
  | "position-line"
  /** Nothing usable was reported. */
  | "none";

export type PositionAnchor = {
  coordinate: PitchCoordinate;
  depthConfidence: DepthConfidence;
  lateralConfidence: LateralConfidence;
  /** Human-readable statement of what this anchor is based on, carried through
   * to the UI so the caption is generated from the same object as the shape. */
  basis: string;
};

export type LineupSlotInput = {
  playerId: string;
  /** The provider's raw formation slot, when there is one. */
  grid?: string | null;
  /** The listed position, free text. */
  position: string | null;
  isStarting: boolean;
};

/**
 * Depth bands for the listed-position fallback, in canonical y (0 = own goal
 * line, 100 = the goal being attacked).
 *
 * These are the average depths the positions describe, not measurements of any
 * player. They exist to place a band, and the aggregator's vertical spread is
 * deliberately wide enough that the band reads as a band. A goalkeeper is the
 * one position where the number is close to a fact rather than an average.
 */
const POSITION_DEPTH: Record<"G" | "D" | "M" | "F", number> = {
  G: 6,
  D: 26,
  M: 50,
  F: 76,
};

/**
 * Normalizes the many ways a feed writes a position onto the four lines KIVO's
 * pitch already draws (`buildPitchRows` in `lineup-pitch.tsx` uses the same
 * four). Returns null for anything unrecognised rather than defaulting to
 * midfield, which would put an unknown player in the middle of the pitch and
 * present that as knowledge.
 */
export function normalizePositionLine(position: string | null | undefined): "G" | "D" | "M" | "F" | null {
  if (typeof position !== "string") return null;
  const p = position.trim().toLowerCase();
  if (p.length === 0) return null;
  if (p === "g" || p.startsWith("goalkeep") || p === "gk") return "G";
  if (p === "d" || p.startsWith("defend") || p.startsWith("back")) return "D";
  if (p === "m" || p.startsWith("midfield")) return "M";
  if (p === "f" || p.startsWith("attack") || p.startsWith("forward") || p.startsWith("striker") || p === "w") return "F";
  return null;
}

export class PlayerPositionMapper {
  /**
   * The maximum formation row seen across a team's starters, used to normalize
   * a row index into a depth. Taken from the real lineup rather than parsed out
   * of the formation string: a team sheet is the thing that actually says how
   * many lines this team set up in, and a formation label ("4-2-3-1") and the
   * grid rows the provider sends do not always agree on how to count them.
   */
  private maxRowFor(slots: readonly LineupSlotInput[]): number | null {
    let max = 0;
    for (const slot of slots) {
      const parsed = parsePitchGrid(slot.grid);
      if (parsed && parsed.row > max) max = parsed.row;
    }
    return max > 0 ? max : null;
  }

  /** The maximum column seen in one specific row, for the same self-calibrating
   * reason — a back four and a front three occupy different widths, and the
   * lineup states both. */
  private maxColInRow(slots: readonly LineupSlotInput[], row: number): number {
    let max = 0;
    for (const slot of slots) {
      const parsed = parsePitchGrid(slot.grid);
      if (parsed && parsed.row === row && parsed.col > max) max = parsed.col;
    }
    return max;
  }

  /**
   * Anchors every starter in one team's lineup.
   *
   * Substitutes are deliberately excluded rather than anchored at their listed
   * position: a substitute has no formation slot, may have played fifteen
   * minutes in a shape nobody recorded, and drawing them on a pitch as though
   * they held a position for the match would be the most misleading thing this
   * module could do. They are handled at the service layer, which lists them as
   * "no positional basis" instead of drawing them.
   */
  anchorTeam(slots: readonly LineupSlotInput[]): Map<string, PositionAnchor> {
    const anchors = new Map<string, PositionAnchor>();
    const maxRow = this.maxRowFor(slots);

    for (const slot of slots) {
      if (!slot.isStarting) continue;
      const anchor = this.anchorFor(slot, slots, maxRow);
      if (anchor) anchors.set(slot.playerId, anchor);
    }
    return anchors;
  }

  /**
   * Anchors one player. Exported behaviour, but normally reached through
   * `anchorTeam` so the row/column calibration has the whole lineup to work
   * from.
   */
  anchorFor(
    slot: LineupSlotInput,
    teamSlots: readonly LineupSlotInput[] = [slot],
    maxRow: number | null = null,
  ): PositionAnchor | null {
    const grid = parsePitchGrid(slot.grid);
    const rows = maxRow ?? this.maxRowFor(teamSlots);

    if (grid && rows && rows > 1) {
      // Row 1 (the goalkeeper) maps to the goalkeeper's depth rather than to
      // 0, so the keeper is drawn in front of their goal line and not on it.
      // Rows above it spread evenly across the remaining pitch. The top row is
      // placed short of the opposition goal line, because a striker's line is
      // where they start, not where the ball ends up.
      const HIGHEST_ROW_DEPTH = 82;
      const depthSpan = HIGHEST_ROW_DEPTH - POSITION_DEPTH.G;
      const y = POSITION_DEPTH.G + ((grid.row - 1) / (rows - 1)) * depthSpan;

      const colsInRow = this.maxColInRow(teamSlots, grid.row);
      // A single-player row (a lone striker, the goalkeeper) is central, and
      // that IS known — there is no other column for them to be in.
      const x =
        colsInRow > 1
          ? ((grid.col - 0.5) / colsInRow) * NORMALIZED_PITCH.width
          : NORMALIZED_PITCH.width / 2;

      return {
        coordinate: { x: clampToPitch(x, NORMALIZED_PITCH.width), y: clampToPitch(y, NORMALIZED_PITCH.height) },
        depthConfidence: "formation-slot",
        lateralConfidence: colsInRow > 1 ? "provider-order" : "none",
        basis:
          colsInRow > 1
            ? "the team sheet's formation slot"
            : "the team sheet's formation slot (central by elimination)",
      };
    }

    const line = normalizePositionLine(slot.position);
    if (line) {
      return {
        coordinate: { x: NORMALIZED_PITCH.width / 2, y: POSITION_DEPTH[line] },
        depthConfidence: "position-line",
        lateralConfidence: "none",
        basis: "the player's listed position",
      };
    }

    // No grid, no recognisable position. There is nothing to anchor to, and
    // guessing would be the fabrication this whole engine exists to avoid.
    return null;
  }
}
