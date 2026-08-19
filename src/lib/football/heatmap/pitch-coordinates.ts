/**
 * KIVO's canonical pitch coordinate system — the "normalized coordinate layer"
 * the founder's heatmap spec asks for, in its own module so that every other
 * part of the engine can depend on one definition of where a point is.
 *
 * ## The system
 *
 * Both axes run 0-100, as specified. Concretely:
 *
 *   y = 0    the subject team's OWN goal line
 *   y = 100  the goal line they are attacking
 *   x = 0    the left touchline, from the attacking team's point of view
 *   x = 100  the right touchline, same point of view
 *
 * It is stated in the subject's own attacking direction rather than in
 * "home team attacks this way" terms, so a coordinate means the same thing for
 * both sides of a match and both halves of one. Nothing downstream has to know
 * which end a team kicked towards, which is exactly the ambiguity that makes
 * raw provider coordinates hard to combine.
 *
 * ## Why this is 100x100 while `PITCH_DIMENSIONS` is 100x140
 *
 * `PITCH_DIMENSIONS` in `../heatmap-engine.ts` is a RENDERING space: it exists
 * to line up exactly with the `0 0 100 140` viewBox `PitchLines` draws, so a
 * grid overlays that graphic with no transform. It is the shape of a picture.
 *
 * This is a SEMANTIC space: 0-100 on both axes, y increasing towards the goal
 * being attacked. It is the shape of a claim about a football pitch.
 *
 * Conflating them would mean a provider integration has to know KIVO's SVG
 * aspect ratio to report a position, and changing the pitch graphic would
 * silently change what every stored coordinate meant. `toRenderSpace` below is
 * the single, tested seam between the two — including the y-axis inversion,
 * because SVG's y grows downwards while a football pitch's attacking direction,
 * as every KIVO pitch already draws it (attack at the top, keeper at the
 * bottom — see `LineupPitch`), grows upwards.
 */

import { PITCH_DIMENSIONS } from "../heatmap-engine";

/** The canonical semantic space. Both axes, deliberately identical. */
export const NORMALIZED_PITCH = { width: 100, height: 100 } as const;

/** A point in the canonical space described above. */
export type PitchCoordinate = {
  /** 0 (attacking-left touchline) to 100 (attacking-right touchline). */
  x: number;
  /** 0 (own goal line) to 100 (goal being attacked). */
  y: number;
};

/**
 * Which way the reader is looking at the pitch.
 *
 * `attacking` draws the subject attacking upwards, which is how every other
 * pitch in KIVO is drawn and how a fan reads a formation. `defensive` flips it,
 * so the same player's shape can be read as "how deep did they sit" against
 * their own goal at the top. The flip is a pure view transform applied at
 * render time — it never changes a stored coordinate, so no data can be
 * corrupted by looking at it the other way round.
 */
export type PitchOrientation = "attacking" | "defensive";

/** True when a coordinate is genuinely on the pitch. Out-of-range points are
 * rejected rather than clamped, for the reason `HeatmapEngine` already
 * documents: clamping turns a provider's own out-of-bounds reading into a
 * confident claim about the touchline. */
export function isOnPitch(point: PitchCoordinate): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= NORMALIZED_PITCH.width &&
    point.y >= 0 &&
    point.y <= NORMALIZED_PITCH.height
  );
}

/** Clamps a value into the pitch's range. Used only when BUILDING a derived
 * anchor (where the arithmetic, not a provider, produced the out-of-range
 * value), never when reading a reported coordinate — see `isOnPitch`. */
export function clampToPitch(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, value));
}

/**
 * Converts a canonical coordinate into the `0 0 100 140` render space that
 * `PitchLines` draws, applying the reader's chosen orientation.
 *
 * The y inversion is the whole point: canonical y grows towards the goal being
 * attacked, SVG y grows downwards, and KIVO draws attack at the top. In
 * `attacking` orientation those cancel out to `renderY = (100 - y) * 1.4`.
 */
export function toRenderSpace(
  point: PitchCoordinate,
  orientation: PitchOrientation = "attacking",
): { x: number; y: number } {
  const y = orientation === "attacking" ? point.y : NORMALIZED_PITCH.height - point.y;
  return {
    x: (point.x / NORMALIZED_PITCH.width) * PITCH_DIMENSIONS.width,
    y: ((NORMALIZED_PITCH.height - y) / NORMALIZED_PITCH.height) * PITCH_DIMENSIONS.height,
  };
}
