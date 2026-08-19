/**
 * The pure, dependency-free assembly of one fixture's heatmap material.
 *
 * This module is deliberately free of `server-only`, of Supabase, and of every
 * async call, for one specific reason: Match Centre is a client component that
 * already holds a fixture's lineups and events as props, and it needs to decide
 * whether a Heatmap tab has anything in it BEFORE offering the tab. Making that
 * decision anywhere other than in the same function that produces the content
 * is how a tab ends up promising something it cannot show — which is the exact
 * failure `match-centre-tabs.tsx`'s own KN-53 comment was written about.
 *
 * So availability and content come from one object:
 *
 *     const heatmaps = buildFixtureHeatmaps({ fixtureId, homeTeamId, awayTeamId, lineups, events });
 *     const available = hasFixtureHeatmapContent(heatmaps);   // gate the tab on this
 *     <HeatmapView heatmaps={heatmaps} ... />                  // render the same object
 *
 * They cannot disagree, because there is nothing for them to disagree about.
 *
 * The server-side path (`HeatmapService`) calls this same function with two
 * extra inputs it can see and a client cannot — the provider's formation-slot
 * `grid`, and per-player match statistics — and produces a strictly better
 * version of the same object. Better, never different in kind: a fixture that
 * is empty here is empty there too.
 */

import { EventNormalizer } from "./event-normalizer";
import type {
  MatchEventInput,
  MatchPeriod,
  NormalizedPitchAction,
  PlayerMatchStatisticsInput,
} from "./event-normalizer";
import { HeatmapAggregator } from "./heatmap-aggregator";
import type { AggregateOptions, AggregatedHeatmap } from "./heatmap-aggregator";
import { PlayerPositionMapper } from "./player-position-mapper";
import type { PositionAnchor } from "./player-position-mapper";
import type { PositionalObservation } from "../positional-types";

/**
 * A lineup row. A structural superset of the `LineupEntry` shape Match Centre
 * already holds, so a caller passes its existing rows straight through with no
 * mapping — `grid` is optional precisely because the client's copy does not
 * carry it and should not have to pretend otherwise.
 */
export type HeatmapLineupInput = {
  teamId: string;
  playerId: string;
  playerName: string;
  isStarting: boolean;
  position: string | null;
  formation: string | null;
  shirtNumber?: number | null;
  grid?: string | null;
};

export type FixtureHeatmapInput = {
  fixtureId: string;
  homeTeamId: string;
  awayTeamId: string;
  lineups: readonly HeatmapLineupInput[];
  events: readonly MatchEventInput[];
  /** Server-side enrichment. Absent on the client. */
  playerStatistics?: readonly PlayerMatchStatisticsInput[];
  /** Real tracked coordinates from a `PositionalDataProvider`. Nothing
   * implements that interface today, so this is always absent in production —
   * the parameter exists so connecting one is a wiring change, not a redesign. */
  observations?: readonly PositionalObservation[];
};

/** One player, everything needed to draw them, and nothing pre-drawn. */
export type PlayerHeatmapSubject = {
  playerId: string;
  playerName: string;
  teamId: string;
  position: string | null;
  shirtNumber: number | null;
  isStarting: boolean;
  /**
   * Null when KIVO has no positional basis for this player at all — every
   * substitute, and any starter whose position the feed did not report in a
   * form this build recognises. A null anchor is rendered as an honest
   * "no positional basis" row, never as a player standing in the centre circle.
   */
  anchor: PositionAnchor | null;
  actions: NormalizedPitchAction[];
};

export type TeamHeatmapSet = {
  teamId: string;
  /** The provider's formation string for this side, when it published one. */
  formation: string | null;
  players: PlayerHeatmapSubject[];
};

export type FixtureHeatmapSet = {
  fixtureId: string;
  home: TeamHeatmapSet;
  away: TeamHeatmapSet;
  /** Which periods actually have timed actions in this fixture. Drives which
   * period chips the UI offers, so a match that never went to extra time never
   * offers an extra-time filter that would render empty. */
  periodsPresent: MatchPeriod[];
  /** True only when real provider coordinates fed this fixture. False for every
   * fixture today. */
  hasTrackedData: boolean;
};

const normalizer = new EventNormalizer();
const mapper = new PlayerPositionMapper();
const aggregator = new HeatmapAggregator();

const PERIOD_ORDER: MatchPeriod[] = ["first-half", "second-half", "extra-time"];

function buildTeam(
  teamId: string,
  input: FixtureHeatmapInput,
  actionsByPlayer: Map<string, NormalizedPitchAction[]>,
): TeamHeatmapSet {
  const slots = input.lineups.filter((entry) => entry.teamId === teamId);
  const anchors = mapper.anchorTeam(slots);

  // The provider repeats the formation on every row for a side (denormalized,
  // the same way `team_id` repeats), so the first row that has one is the
  // side's formation. Reading it off any row rather than requiring row zero
  // means a lineup whose first entry happens to lack it still resolves.
  const formation = slots.find((entry) => entry.formation)?.formation ?? null;

  const players: PlayerHeatmapSubject[] = slots.map((entry) => ({
    playerId: entry.playerId,
    playerName: entry.playerName,
    teamId,
    position: entry.position,
    shirtNumber: entry.shirtNumber ?? null,
    isStarting: entry.isStarting,
    anchor: anchors.get(entry.playerId) ?? null,
    actions: actionsByPlayer.get(entry.playerId) ?? [],
  }));

  // Starters first, then by shirt number — the order a team sheet is read in.
  // Deliberately not sorted by action count: ordering players by how much they
  // did would turn a selector into a ranking KIVO never computed.
  players.sort((a, b) => {
    if (a.isStarting !== b.isStarting) return a.isStarting ? -1 : 1;
    const an = a.shirtNumber ?? Number.MAX_SAFE_INTEGER;
    const bn = b.shirtNumber ?? Number.MAX_SAFE_INTEGER;
    if (an !== bn) return an - bn;
    return a.playerName.localeCompare(b.playerName);
  });

  return { teamId, formation, players };
}

/**
 * Assembles everything needed to draw any player's heatmap for this fixture,
 * without drawing any of them. Grids are built on demand by
 * `buildPlayerHeatmap`, so switching player, half or orientation is arithmetic
 * on data already in hand rather than a recomputation of the fixture.
 */
export function buildFixtureHeatmaps(input: FixtureHeatmapInput): FixtureHeatmapSet {
  const actions: NormalizedPitchAction[] = [
    ...normalizer.fromMatchEvents(input.events),
    ...(input.playerStatistics ? normalizer.fromPlayerMatchStatistics(input.playerStatistics) : []),
  ];

  // Observations are scoped per team by the caller that fetched them; the team
  // id is attached here so a player's actions carry the same team as their
  // lineup row. Nothing produces observations today.
  if (input.observations && input.observations.length > 0) {
    const teamByPlayer = new Map(input.lineups.map((entry) => [entry.playerId, entry.teamId]));
    for (const observation of input.observations) {
      const teamId = teamByPlayer.get(observation.playerId);
      if (!teamId) continue;
      actions.push(...normalizer.fromObservations([observation], teamId));
    }
  }

  const actionsByPlayer = new Map<string, NormalizedPitchAction[]>();
  const periods = new Set<MatchPeriod>();
  for (const action of actions) {
    const list = actionsByPlayer.get(action.playerId);
    if (list) list.push(action);
    else actionsByPlayer.set(action.playerId, [action]);
    if (action.period) periods.add(action.period);
  }

  return {
    fixtureId: input.fixtureId,
    home: buildTeam(input.homeTeamId, input, actionsByPlayer),
    away: buildTeam(input.awayTeamId, input, actionsByPlayer),
    periodsPresent: PERIOD_ORDER.filter((period) => periods.has(period)),
    hasTrackedData: actions.some((action) => action.coordinate !== null),
  };
}

/**
 * Whether this fixture has anything worth showing.
 *
 * True exactly when at least one player on either side could be anchored — and
 * an anchored player always produces a drawable grid, because presence at the
 * formation slot is itself real information. False for an unsynced fixture, for
 * a fixture whose lineup carries no usable positions, and for a fixture before
 * kickoff. Gate the tab on this and it can never be offered empty.
 */
export function hasFixtureHeatmapContent(set: FixtureHeatmapSet): boolean {
  return [...set.home.players, ...set.away.players].some((player) => player.anchor !== null);
}

/** Builds one player's grid for one period. Cheap enough to call on every
 * selector change. */
export function buildPlayerHeatmap(
  subject: PlayerHeatmapSubject,
  options: AggregateOptions = {},
): AggregatedHeatmap {
  return aggregator.aggregate(subject.actions, subject.anchor, options);
}
