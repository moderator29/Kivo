/**
 * `EventNormalizer` — the second of the five services the founder's heatmap
 * spec names, and the one the honesty of the whole feature rests on.
 *
 * ## What it does
 *
 * It converts every kind of thing KIVO knows about a player's involvement in a
 * match into ONE shape, `NormalizedPitchAction`, so that everything downstream
 * reasons about a single type instead of three provider payloads. Three sources
 * feed it today:
 *
 *   1. `fixture_events` rows — goals, cards, substitutions. Minute-stamped.
 *   2. per-player per-fixture statistics — shot, pass, tackle, interception,
 *      duel, dribble and foul COUNTS. Not minute-stamped.
 *   3. real `PositionalObservation`s from a `PositionalDataProvider` — the only
 *      source that carries coordinates. Nothing implements that interface
 *      today, so in production this input is always empty.
 *
 * ## The line this module draws, and never crosses
 *
 * `coordinate` is `PitchCoordinate | null`, and it is non-null for source (3)
 * and ONLY source (3). Sources (1) and (2) are counts of things a player did;
 * API-Football publishes no coordinate for any of them on any plan, and this
 * module does not invent one. A derived heatmap is built later, by
 * `HeatmapAggregator`, from an anchor plus these coordinate-less actions — and
 * everything it produces is tagged `derived` all the way to the caption the
 * reader sees.
 *
 * That is the difference between an honest approximation and a fabrication: a
 * fabrication would put a plausible x and y on a tackle nobody located, hand it
 * to `HeatmapEngine` alongside real observations, and become indistinguishable
 * from measurement one function call later.
 *
 * ## Periods
 *
 * `period` is nullable for the same reason. A goal in the 63rd minute happened
 * in the second half — that is a fact. A player's 41 completed passes did not
 * happen in any particular half; the provider reports one number for the match.
 * So statistic-derived actions carry `period: null`, and asking for one half
 * genuinely excludes them. `HeatmapAggregator` counts what it had to drop and
 * reports it, so the UI can say "half-match view covers timed events only"
 * rather than quietly showing a thinner picture as if it were the whole one.
 */

import type { PositionalObservation } from "../positional-types";
import { isOnPitch, type PitchCoordinate } from "./pitch-coordinates";

/**
 * Which part of a match an action belongs to.
 *
 * Extra time is its own value rather than being folded into the second half: a
 * 97th-minute action is not a second-half action, and a reader filtering to
 * "second half" should not silently receive it. Consumers that want everything
 * ask for the full match.
 */
export type MatchPeriod = "first-half" | "second-half" | "extra-time";

/**
 * How an action relates to a player's position on the pitch.
 *
 * These classes exist for exactly one purpose: they are the only defensible
 * basis for saying a derived heatmap should lean towards one end of a player's
 * zone rather than sit uniformly on their formation slot. A defender who made
 * nine interceptions and no shots was, on any reading of football, operating
 * deeper than one who took four shots. That is an inference — a well-founded
 * one, but an inference — and it is why everything built on these classes is
 * labelled as derived.
 */
export type PitchActionClass =
  | "goalkeeping"
  | "defensive"
  | "buildUp"
  | "attacking"
  | "discipline"
  | "unclassified";

/** The single shape every source is converted into. */
export type NormalizedPitchAction = {
  playerId: string;
  teamId: string;
  actionClass: PitchActionClass;
  /**
   * How many times this happened. 1 for a single timeline event; the reported
   * count for a statistic (41 passes is one action with weight 41, not 41
   * actions, so nothing downstream can mistake a count for a set of located
   * events).
   */
  weight: number;
  /** Null when the action cannot be attributed to a period — see this module's
   * doc comment. Never guessed. */
  period: MatchPeriod | null;
  /** Null for everything except a real tracked observation. Never synthesized. */
  coordinate: PitchCoordinate | null;
  /** Where this came from, for attribution and for the aggregator's decision
   * about whether a real (tracked) heatmap is possible at all. */
  sourceKind: "match-event" | "player-match-statistic" | "tracked-observation";
  /** Free text identifying the feed, carried through from
   * `PositionalObservation.source` where there is one. */
  source: string;
};

/** A `fixture_events` row, in the shape both the DB and Match Centre already
 * hold it. Typed structurally (`eventType` is a plain string) so a caller can
 * pass its existing rows without mapping. */
export type MatchEventInput = {
  teamId: string;
  playerId: string | null;
  eventType: string;
  minute: number;
  addedTime?: number | null;
};

/** Per-player per-fixture statistics, in the shape
 * `NormalizedPlayerFixtureStatistics` and the `fixture_player_statistics` table
 * both carry. Every field optional and nullable: null means the provider did
 * not report it, and a null contributes nothing rather than contributing zero. */
export type PlayerMatchStatisticsInput = {
  playerId: string;
  teamId: string;
  minutesPlayed?: number | null;
  shotsTotal?: number | null;
  shotsOnTarget?: number | null;
  goals?: number | null;
  assists?: number | null;
  saves?: number | null;
  passesTotal?: number | null;
  passesKey?: number | null;
  tacklesTotal?: number | null;
  blocks?: number | null;
  interceptions?: number | null;
  duelsTotal?: number | null;
  duelsWon?: number | null;
  dribblesAttempted?: number | null;
  dribblesSucceeded?: number | null;
  foulsDrawn?: number | null;
  foulsCommitted?: number | null;
};

/**
 * Maps a `fixture_event_type` value onto an action class.
 *
 * Substitutions are `unclassified` on purpose. A substitution is a fact about a
 * player's availability, not about where they played, and letting it pull a
 * heatmap in any direction would be reading meaning into an administrative
 * event. It is normalized (so the timeline stays complete and the period split
 * is honest) and then contributes nothing to shape.
 */
export function classifyMatchEvent(eventType: string): PitchActionClass {
  switch (eventType) {
    case "goal":
    case "penalty_goal":
    case "penalty_missed":
      return "attacking";
    case "own_goal":
      // Scored at the wrong end, but it is still an event at the defensive end
      // of the pitch, which is the only thing this classification claims.
      return "defensive";
    case "yellow_card":
    case "second_yellow_card":
    case "red_card":
      return "discipline";
    case "substitution":
    case "var_review":
      return "unclassified";
    default:
      return "unclassified";
  }
}

/**
 * Which period a minute belongs to.
 *
 * The boundaries are the laws of the game, not a heuristic: a match is 45 + 45,
 * and anything past 90 is extra time. Added time is deliberately NOT added to
 * `minute` before the comparison — a provider reports the 45th minute plus two
 * added, and calling that the 47th minute would move a first-half action into
 * the second half.
 */
export function periodForMinute(minute: number): MatchPeriod | null {
  if (!Number.isFinite(minute) || minute < 0) return null;
  if (minute <= 45) return "first-half";
  if (minute <= 90) return "second-half";
  return "extra-time";
}

/** How a `PitchEventType` from a real positional feed maps onto an action
 * class. Only ever applied to observations that already carry coordinates, so
 * the class is used for attribution and filtering rather than for inferring
 * position. */
function classifyObservation(eventType: PositionalObservation["eventType"]): PitchActionClass {
  switch (eventType) {
    case "shot":
      return "attacking";
    case "tackle":
    case "duel":
      return "defensive";
    case "pass":
    case "carry":
    case "reception":
    case "touch":
      return "buildUp";
    default:
      return "unclassified";
  }
}

export class EventNormalizer {
  /**
   * Timeline events. One action per event, weight 1, no coordinate — because
   * there is no coordinate in the payload (verified against the committed
   * API-Football adapter: a fixture event carries time, team, player, assist,
   * type and detail, and nothing spatial).
   *
   * Events with no player attached (a team-level VAR review, an unattributed
   * card) are dropped: a heatmap is per-player, and there is no player to
   * attribute them to.
   */
  fromMatchEvents(events: readonly MatchEventInput[], source = "kivo:fixture_events"): NormalizedPitchAction[] {
    const actions: NormalizedPitchAction[] = [];
    for (const event of events) {
      if (!event.playerId) continue;
      actions.push({
        playerId: event.playerId,
        teamId: event.teamId,
        actionClass: classifyMatchEvent(event.eventType),
        weight: 1,
        period: periodForMinute(event.minute),
        coordinate: null,
        sourceKind: "match-event",
        source,
      });
    }
    return actions;
  }

  /**
   * Per-player match statistics. One action per reported statistic, weighted by
   * the count, `period: null` because a match total belongs to no half.
   *
   * A null statistic produces nothing at all. A zero produces nothing either —
   * not because zero is unknown (it is a real answer) but because an action
   * that happened zero times cannot contribute weight to a distribution, and
   * emitting weight-0 actions would only pad the action count the UI reports to
   * the reader.
   */
  fromPlayerMatchStatistics(
    stats: readonly PlayerMatchStatisticsInput[],
    source = "kivo:fixture_player_statistics",
  ): NormalizedPitchAction[] {
    const actions: NormalizedPitchAction[] = [];

    const push = (stat: PlayerMatchStatisticsInput, actionClass: PitchActionClass, value: number | null | undefined) => {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return;
      actions.push({
        playerId: stat.playerId,
        teamId: stat.teamId,
        actionClass,
        weight: value,
        period: null,
        coordinate: null,
        sourceKind: "player-match-statistic",
        source,
      });
    };

    for (const stat of stats) {
      // Attacking involvement.
      push(stat, "attacking", stat.shotsTotal);
      push(stat, "attacking", stat.dribblesSucceeded ?? stat.dribblesAttempted);
      push(stat, "attacking", stat.passesKey);
      push(stat, "attacking", stat.foulsDrawn);
      // Build-up: the bulk of most outfield players' involvement, and the
      // reason a derived shape sits near the formation slot rather than at one
      // end of it. `passesTotal` deliberately includes key passes rather than
      // subtracting them — the provider's own totals are not documented as
      // disjoint, and subtracting on an assumption would produce a number
      // neither the provider nor KIVO could stand behind.
      push(stat, "buildUp", stat.passesTotal);
      // Defensive work.
      push(stat, "defensive", stat.tacklesTotal);
      push(stat, "defensive", stat.interceptions);
      push(stat, "defensive", stat.blocks);
      push(stat, "defensive", stat.foulsCommitted);
      // Duels happen everywhere; they say a player was involved, not where.
      push(stat, "unclassified", stat.duelsTotal);
      // Goalkeeping is the one class that genuinely pins a player to a place.
      push(stat, "goalkeeping", stat.saves);
    }

    return actions;
  }

  /**
   * Real tracked observations. The only path that produces a coordinate.
   *
   * Out-of-pitch observations are dropped rather than clamped, matching
   * `HeatmapEngine`'s existing rule and for the same reason: a provider
   * reporting a point off the pitch has told KIVO something, and moving it to
   * the touchline would replace that with a confident claim KIVO invented.
   */
  fromObservations(observations: readonly PositionalObservation[], teamId: string): NormalizedPitchAction[] {
    const actions: NormalizedPitchAction[] = [];
    for (const observation of observations) {
      const coordinate: PitchCoordinate = { x: observation.x, y: observation.y };
      if (!isOnPitch(coordinate)) continue;
      actions.push({
        playerId: observation.playerId,
        teamId,
        actionClass: classifyObservation(observation.eventType),
        weight: 1,
        // A real feed timestamps observations in wall-clock ISO time, not match
        // minutes. Deriving a match minute from that would need the kickoff
        // time and every stoppage, so the period is left unattributed rather
        // than approximated — the same rule the statistics path follows.
        period: null,
        coordinate,
        sourceKind: "tracked-observation",
        source: observation.source,
      });
    }
    return actions;
  }
}
