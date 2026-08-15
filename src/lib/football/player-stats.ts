import type { Database } from "@/lib/supabase/types";

type FixtureEventType = Database["public"]["Enums"]["fixture_event_type"];
type FixtureStatus = Database["public"]["Enums"]["fixture_status"];

/** A lineup row against a fixture in any of these statuses means the player
 * has actually taken the pitch — "scheduled" fixtures don't count as an
 * appearance yet. Shared by `players/[id]` and the player comparison page
 * (RECOMMENDATIONS.md item 167), which were computing this identically. */
export const PLAYED_STATUSES = new Set<FixtureStatus>(["live", "halftime", "finished"]);

export type PlayerMatchStats = {
  appearances: number;
  starts: number;
  goals: number;
  yellowCards: number;
  redCards: number;
};

/**
 * Real appearance/goal/card totals from `lineups` + `fixture_events` rows
 * already scoped to one player (both queried with `.eq("player_id", id)` by
 * the caller). Pure and DB-client-free so it's trivially reused for two
 * players side by side without a second round of near-identical filtering
 * logic.
 */
export function computePlayerMatchStats(
  lineupRows: { is_starting: boolean; fixture: { status: FixtureStatus } | null }[],
  eventRows: { event_type: FixtureEventType }[],
): PlayerMatchStats {
  const appearances = lineupRows.filter((l) => l.fixture && PLAYED_STATUSES.has(l.fixture.status));
  const starts = appearances.filter((l) => l.is_starting).length;

  const countEvents = (types: FixtureEventType[]) => eventRows.filter((e) => types.includes(e.event_type)).length;

  return {
    appearances: appearances.length,
    starts,
    goals: countEvents(["goal", "penalty_goal"]),
    yellowCards: countEvents(["yellow_card"]),
    redCards: countEvents(["red_card", "second_yellow_card"]),
  };
}
