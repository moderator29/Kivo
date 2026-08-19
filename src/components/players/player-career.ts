import type { Database } from "@/lib/supabase/types";
import { computePlayerMatchRating, type PlayerMatchRating } from "@/lib/football/rating-engine";
import { resultFor, type FormResult } from "@/lib/football/results";

/**
 * The two derivations a player page needs that nothing else in KIVO already
 * does: one match at a time, and one season at a time.
 *
 * Both are pure and both refuse to guess. `null` never becomes `0` anywhere in
 * this file — a provider that did not report minutes has not reported that a
 * player played none of them, and a season row with no goals figure is not a
 * season with no goals.
 */

type FixtureEventType = Database["public"]["Enums"]["fixture_event_type"];

/** One fixture this player was named in, already joined to the fixture and
 * resolved to the team they were named FOR (`lineups.team_id`). */
export type PlayerFixtureInput = {
  fixtureId: string;
  kickoffAt: string;
  status: string;
  teamId: string;
  isStarting: boolean;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
};

/** A `fixture_events` row with this player in the subject slot (`player_id`)
 * or the related slot (`related_player_id`). */
export type PlayerEventInput = { fixtureId: string; eventType: FixtureEventType };

export type PlayerMatchEntry = {
  fixtureId: string;
  kickoffAt: string;
  /** From this player's team's perspective. Null unless the match is finished
   * with a real score on both sides. */
  result: FormResult | null;
  ownScore: number | null;
  oppScore: number | null;
  /** Which side of the fixture this player's team was on, so the caller can
   * name the opponent without re-deriving it. */
  opponentTeamId: string;
  isHome: boolean;
  isStarting: boolean;
  cameOnFromBench: boolean;
  goals: number;
  assists: number;
  ownGoals: number;
  yellowCards: number;
  redCards: number;
  /** Real minutes from `fixture_player_statistics`, or null when the provider
   * reported none. Never inferred from "started" — a starter can be
   * substituted, and 90 would be a made-up number. */
  minutesPlayed: number | null;
  /** KIVO's own computed match rating, or null when the engine refuses one
   * (fixture not finished, no score, or no evidence this player was involved).
   * See `src/lib/football/rating-engine.ts`. */
  rating: PlayerMatchRating | null;
};

/**
 * One row per match this player was named in, newest first.
 *
 * The rating comes from the shared KIVO Rating Engine rather than anything
 * computed here, so a rating on a player page and the same rating in the Match
 * Centre are the same number produced by the same weights — and it is `null`
 * for an unused substitute, which is the case that would otherwise silently
 * become a fabricated 6.0.
 */
export function buildPlayerMatchLog({
  playerId,
  position,
  fixtures,
  subjectEvents,
  relatedEvents,
  minutesByFixture,
}: {
  playerId: string;
  position: string | null;
  fixtures: PlayerFixtureInput[];
  subjectEvents: PlayerEventInput[];
  /** Events where this player is `related_player_id`: assists on a goal, and
   * the incoming half of a substitution (API-Football's own convention, see
   * `team-sheet.ts`). */
  relatedEvents: PlayerEventInput[];
  minutesByFixture: Map<string, number | null>;
}): PlayerMatchEntry[] {
  const subjectByFixture = new Map<string, FixtureEventType[]>();
  for (const event of subjectEvents) {
    const list = subjectByFixture.get(event.fixtureId);
    if (list) list.push(event.eventType);
    else subjectByFixture.set(event.fixtureId, [event.eventType]);
  }
  const relatedByFixture = new Map<string, FixtureEventType[]>();
  for (const event of relatedEvents) {
    const list = relatedByFixture.get(event.fixtureId);
    if (list) list.push(event.eventType);
    else relatedByFixture.set(event.fixtureId, [event.eventType]);
  }

  return fixtures
    .map((fixture): PlayerMatchEntry => {
      const subject = subjectByFixture.get(fixture.fixtureId) ?? [];
      const related = relatedByFixture.get(fixture.fixtureId) ?? [];

      const goals = subject.filter((type) => type === "goal" || type === "penalty_goal").length;
      const ownGoals = subject.filter((type) => type === "own_goal").length;
      const yellowCards = subject.filter((type) => type === "yellow_card").length;
      // Second yellows count as a dismissal, the same convention
      // `player-stats.ts` and `fantasy-scoring.ts` already use.
      const redCards = subject.filter((type) => type === "red_card" || type === "second_yellow_card").length;
      const assists = related.filter((type) => type === "goal" || type === "penalty_goal").length;
      const cameOnFromBench = related.includes("substitution");

      const isHome = fixture.homeTeamId === fixture.teamId;
      const opponentTeamId = isHome ? fixture.awayTeamId : fixture.homeTeamId;

      const finishedWithScore =
        fixture.status === "finished" && fixture.homeScore !== null && fixture.awayScore !== null;
      const ownScore = finishedWithScore ? (isHome ? fixture.homeScore : fixture.awayScore) : null;
      const oppScore = finishedWithScore ? (isHome ? fixture.awayScore : fixture.homeScore) : null;

      return {
        fixtureId: fixture.fixtureId,
        kickoffAt: fixture.kickoffAt,
        result: ownScore !== null && oppScore !== null ? resultFor(ownScore, oppScore) : null,
        ownScore,
        oppScore,
        opponentTeamId,
        isHome,
        isStarting: fixture.isStarting,
        cameOnFromBench,
        goals,
        assists,
        ownGoals,
        yellowCards,
        redCards,
        minutesPlayed: minutesByFixture.get(fixture.fixtureId) ?? null,
        rating: computePlayerMatchRating({
          playerId,
          fixtureId: fixture.fixtureId,
          fixtureStatus: fixture.status,
          position,
          isStarting: fixture.isStarting,
          cameOnFromBench,
          goals,
          assists,
          ownGoals,
          yellowCards,
          redCards,
          teamGoalsFor: ownScore,
          teamGoalsAgainst: oppScore,
        }),
      };
    })
    .sort((a, b) => new Date(b.kickoffAt).getTime() - new Date(a.kickoffAt).getTime());
}

/** A `player_season_statistics` row, reduced to the columns a career view
 * reads. Every one of them is nullable in the table and stays nullable here. */
export type SeasonStatisticsRow = {
  season_year: number;
  appearances: number | null;
  minutes_played: number | null;
  goals: number | null;
  assists: number | null;
};

export type CareerSeason = {
  seasonYear: number;
  /** How many competition rows this season is made of. */
  competitions: number;
  /** Each total is null when NO row in the season reported that column, and
   * carries its own `…Reported` count when only some did — so a total that
   * spans fewer competitions than the season has is visibly partial rather
   * than quietly short. */
  appearances: number | null;
  appearancesReported: number;
  minutes: number | null;
  minutesReported: number;
  goals: number | null;
  goalsReported: number;
  assists: number | null;
  assistsReported: number;
};

function sumColumn(
  rows: SeasonStatisticsRow[],
  pick: (row: SeasonStatisticsRow) => number | null,
): { total: number | null; reported: number } {
  const values = rows.map(pick).filter((value): value is number => value !== null);
  if (values.length === 0) return { total: null, reported: 0 };
  return { total: values.reduce((sum, value) => sum + value, 0), reported: values.length };
}

/**
 * A career, one season per row, newest first.
 *
 * Each season sums the competitions the provider reported for it. Nothing is
 * summed ACROSS seasons into a single career total — see this module's note in
 * `season-statistics-panel.tsx`: a career total whose seasons are only partly
 * covered looks exactly like one that is complete, and there is no way to tell
 * them apart once they are added up.
 */
export function summarizeCareerBySeason(rows: SeasonStatisticsRow[]): CareerSeason[] {
  const bySeason = new Map<number, SeasonStatisticsRow[]>();
  for (const row of rows) {
    const list = bySeason.get(row.season_year);
    if (list) list.push(row);
    else bySeason.set(row.season_year, [row]);
  }

  return Array.from(bySeason.entries())
    .map(([seasonYear, seasonRows]) => {
      const appearances = sumColumn(seasonRows, (row) => row.appearances);
      const minutes = sumColumn(seasonRows, (row) => row.minutes_played);
      const goals = sumColumn(seasonRows, (row) => row.goals);
      const assists = sumColumn(seasonRows, (row) => row.assists);
      return {
        seasonYear,
        competitions: seasonRows.length,
        appearances: appearances.total,
        appearancesReported: appearances.reported,
        minutes: minutes.total,
        minutesReported: minutes.reported,
        goals: goals.total,
        goalsReported: goals.reported,
        assists: assists.total,
        assistsReported: assists.reported,
      };
    })
    .sort((a, b) => b.seasonYear - a.seasonYear);
}

/** True when at least two seasons carry a real goal or assist figure — below
 * that there is no progression to draw, only a single bar pretending to be a
 * trend. */
export function hasCareerProgression(seasons: CareerSeason[]): boolean {
  return seasons.filter((season) => season.goals !== null || season.assists !== null).length >= 2;
}
