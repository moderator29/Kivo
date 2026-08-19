import type { Database } from "@/lib/supabase/types";

type FixtureEventType = Database["public"]["Enums"]["fixture_event_type"];
type FixtureStatus = Database["public"]["Enums"]["fixture_status"];

/** A lineup row against a fixture in any of these statuses means the player
 * has actually taken the pitch — "scheduled" fixtures don't count as an
 * appearance yet. Shared by `players/[id]` and the player comparison page
 * (RECOMMENDATIONS.md item 167), which were computing this identically. */
export const PLAYED_STATUSES = new Set<FixtureStatus>(["live", "halftime", "finished"]);

/**
 * The goal event types that can carry an assister.
 *
 * An own goal never has one, and a penalty is not assisted in the sense any
 * competition records — API-Football does populate `assist` on some penalty
 * events (the player who won it), which is a different fact. `fantasy-scoring.ts`
 * credits `related_player_id` on both `goal` and `penalty_goal`, and this list
 * matches it deliberately: two surfaces disagreeing about whether a player has
 * five assists or four, in the same product, is worse than either answer.
 */
export const ASSISTED_GOAL_EVENT_TYPES: FixtureEventType[] = ["goal", "penalty_goal"];

export type PlayerMatchStats = {
  appearances: number;
  starts: number;
  goals: number;
  /** `null` when the caller did not ask for assist rows at all — which is not
   * the same as a player who has none. See `computePlayerMatchStats`. */
  assists: number | null;
  yellowCards: number;
  redCards: number;
};

/**
 * Real appearance/goal/assist/card totals from `lineups` + `fixture_events`
 * rows already scoped to one player. Pure and DB-client-free so it's trivially
 * reused for two players side by side without a second round of near-identical
 * filtering logic.
 *
 * ## Where assists come from, and why from here
 *
 * KIVO has two real assist sources, and they are not interchangeable:
 *
 *   1. **`fixture_events.related_player_id`** — API-Football's `assist` field
 *      on a goal event, mapped through by `sync-match-details.ts` since the
 *      first version of the sync. This is an *attribution*: which player set
 *      up which goal. `fantasy-scoring.ts` has always awarded `ASSIST_POINTS`
 *      from it.
 *   2. **`fixture_player_statistics.assists`** — a per-match count from
 *      `/fixtures/players`, synced per competition and gated by the coverage
 *      registry (migrations 0081/0082).
 *
 * This function uses (1), and every surface that shows a player's goals uses
 * it, for one reason: **the goal number and the assist number must be counted
 * over the same set of matches.** Goals here come from `fixture_events`, which
 * KIVO syncs for any fixture whose details have been fetched;
 * `fixture_player_statistics` exists only for competitions the coverage
 * registry says will serve it. Mixing the two would put "Goals 12, Assists 2"
 * on a player page — and on a share card that leaves the app — where the 12
 * spans a season and the 2 spans the three matches with per-player stats. Both
 * numbers would be true and the pair would be a lie.
 *
 * `assistEventRows` is therefore explicitly nullable rather than defaulted to
 * an empty array: a caller that has not queried assists reports `null`
 * ("unknown"), and every consumer omits the stat. Defaulting to `[]` would
 * have every existing call site silently start claiming zero assists.
 */
export function computePlayerMatchStats(
  lineupRows: { is_starting: boolean; fixture: { status: FixtureStatus } | null }[],
  eventRows: { event_type: FixtureEventType }[],
  /** Goal events where THIS player is `related_player_id` — i.e. the assister.
   * Pass `null` when the caller did not query them. */
  assistEventRows: { event_type: FixtureEventType }[] | null = null,
): PlayerMatchStats {
  const appearances = lineupRows.filter((l) => l.fixture && PLAYED_STATUSES.has(l.fixture.status));
  const starts = appearances.filter((l) => l.is_starting).length;

  const countEvents = (rows: { event_type: FixtureEventType }[], types: FixtureEventType[]) =>
    rows.filter((e) => types.includes(e.event_type)).length;

  return {
    appearances: appearances.length,
    starts,
    goals: countEvents(eventRows, ["goal", "penalty_goal"]),
    // Filtered again here rather than trusted from the query: an own goal has
    // no assister, and a substitution event also carries a `related_player_id`
    // (the player coming on), so an unfiltered "rows where related_player_id
    // is me" count would read every substitution as an assist.
    assists: assistEventRows === null ? null : countEvents(assistEventRows, ASSISTED_GOAL_EVENT_TYPES),
    yellowCards: countEvents(eventRows, ["yellow_card"]),
    redCards: countEvents(eventRows, ["red_card", "second_yellow_card"]),
  };
}
