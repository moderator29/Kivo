/**
 * Pure seam for a future real positional/touch-tracking data vendor.
 *
 * No current `FootballDataProvider` implementation (API-Football, or the
 * dev-only mock) produces anything that satisfies this interface — the free
 * tier reports no touch/positional coordinate data at all (confirmed in
 * `BUILD_STATUS.md`). This file exists purely so `HeatmapEngine` and any UI
 * built against it (`HeatmapView`) have a stable, real contract to consume
 * once a real vendor is connected, without a redesign at that point. It is
 * deliberately provider-agnostic: nothing here references any specific
 * vendor's name, request shape, or field naming, past or future.
 */

/** The kind of on-pitch action a positional observation was recorded during.
 * "unknown" exists for the same reason `NormalizedMatchEventType` in
 * `types.ts` has one — a future provider's own event taxonomy won't always
 * map cleanly onto this list, and an unmapped observation should say so
 * rather than be miscategorized. */
export type PitchEventType = "touch" | "pass" | "shot" | "tackle" | "carry" | "duel" | "reception" | "unknown";

/**
 * One real, timestamped positional observation from a connected provider.
 * `x`/`y` are on the canonical pitch coordinate system `HeatmapEngine`
 * expects — see `PITCH_DIMENSIONS` in `heatmap-engine.ts` — always reported
 * as the observed player's team attacking in a fixed direction, so
 * observations from both halves of a match sit in one consistent frame.
 */
export interface PositionalObservation {
  playerId: string;
  matchId: string;
  /** ISO 8601. */
  timestamp: string;
  /** 0 to `PITCH_DIMENSIONS.width` (heatmap-engine.ts). */
  x: number;
  /** 0 to `PITCH_DIMENSIONS.height` (heatmap-engine.ts). */
  y: number;
  eventType: PitchEventType;
  /** 0-1 confidence the provider itself reports for this observation, when
   * it reports one at all — null when the provider gives no confidence
   * signal. Never invented when the provider doesn't supply it; a null
   * confidence is treated as fully trusted by `HeatmapEngine`, same as
   * omitting the field would be. */
  confidence: number | null;
  /** Free text identifying which vendor/feed produced this observation —
   * required so a future mixed multi-provider dataset can be filtered or
   * attributed per source. Deliberately untyped (not a fixed enum of known
   * vendors) so adding a provider never requires touching this file. */
  source: string;
}

/**
 * The contract any future real positional-data vendor implements. Modeled
 * after `FootballDataProvider` in `types.ts` (a `readonly name`, methods
 * that return real data or an empty/null result — never a fabricated one)
 * but kept entirely separate from it: positional data is a distinct concern
 * from fixtures/lineups/events, and no existing provider is expected to
 * grow into this interface incidentally.
 */
export interface PositionalDataProvider {
  readonly name: string;
  /** All real observations for one player in one match. Empty array when
   * the provider has none for this player/match — never fabricated or
   * interpolated points standing in for missing coverage. */
  getPlayerPositions(fixtureId: string, playerId: string): Promise<PositionalObservation[]>;
  /** All real observations for every player on one team in one match. */
  getTeamPositions(fixtureId: string, teamId: string): Promise<PositionalObservation[]>;
}
