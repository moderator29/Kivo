import { parsePitchGrid } from "./providers/normalizers";
import type { FixtureEventType } from "./event-labels";

/**
 * The team sheet: one club's lineup for one fixture, with every real thing
 * that happened to each named player folded in.
 *
 * This module exists because the Match Centre's Lineups tab was a pair of
 * name lists. A team sheet a fan recognises answers four questions at once —
 * who started and in what shape, who scored or was booked, who came off and
 * when, and who is on the bench — and all four are already in KIVO's own
 * tables (`lineups` + `fixture_events`). Nothing here is fetched, derived by
 * inference, or estimated: every number is a count of rows that exist.
 *
 * Pure and DB-client-free on purpose (same convention as `player-stats.ts`
 * and `form-engine.ts`) so the client components that render a pitch can
 * import it directly, and so it can be unit-tested against realistic fixture
 * data without a database.
 *
 * ## What it deliberately does not do
 *
 * It never invents a position, a minute, or a lateral placement. A player the
 * provider gave no formation slot for gets no slot; a substitution KIVO holds
 * no event for produces no on/off marker; and nothing in here decides which
 * touchline a column belongs to — see `pitchRowsFromGrid` below.
 */

/** One `lineups` row, in the shape the Match Centre already reads it. */
export type TeamSheetLineupEntry = {
  teamId: string;
  isStarting: boolean;
  shirtNumber: number | null;
  position: string | null;
  /** Real synced formation string ("4-2-3-1"), repeated on every row for the
   * team, null when the provider published none. */
  formation: string | null;
  /** The provider's own "row:col" formation slot. Null for every substitute. */
  grid: string | null;
  playerId: string;
  playerName: string;
};

/** One `fixture_events` row, reduced to the fields a team sheet reads. */
export type TeamSheetEvent = {
  eventType: FixtureEventType;
  minute: number;
  addedTime: number | null;
  teamId: string;
  playerId: string | null;
  relatedPlayerId: string | null;
};

/**
 * A minute as football writes it: 45+2, 90+4. `added` is null for the
 * overwhelming majority of events, and the two are kept apart rather than
 * summed so "90+4" never becomes a nonsensical "94th minute".
 */
export type MatchMinute = { minute: number; added: number | null };

export type TeamSheetPlayer = {
  playerId: string;
  playerName: string;
  shirtNumber: number | null;
  /** The provider's coarse deployment letter (G/D/M/F), verbatim. */
  position: string | null;
  isStarting: boolean;
  /** Goals and converted penalties, counted the same way `player-stats.ts`
   * counts them so the two surfaces can never disagree. */
  goals: number;
  ownGoals: number;
  /** Assists credited on `goal`/`penalty_goal` only — a substitution also
   * carries `related_player_id` and counting it would make every bench
   * appearance an assist (see docs/API_FOOTBALL.md). */
  assists: number;
  yellowCards: number;
  /** Straight reds and second yellows, matching `isRedCardEventType`. */
  redCards: number;
  penaltiesMissed: number;
  /** When this player came off, from a real substitution event. Null means
   * KIVO holds no such event — which for a starter in a finished match most
   * often means they played the full 90, but this module does not assert
   * that, because an unsynced substitution looks identical from here. */
  wentOff: MatchMinute | null;
  /** When this player came on. Null for every starter, and for a named
   * substitute KIVO has no substitution event for — which includes every
   * unused substitute. */
  cameOn: MatchMinute | null;
};

/** One line of the pitch. Rows arrive furthest-forward first. */
export type TeamSheetRow = {
  /** Stable key for React. Not a label — nothing renders it. */
  key: string;
  players: TeamSheetPlayer[];
};

/**
 * How the pitch rows were worked out, so the UI can caption itself from the
 * same object it draws.
 *
 *  - `formation-slot`: every starter carried the provider's own `grid`, so
 *    the lines are the team sheet's real lines — a 4-2-3-1 draws as four
 *    bands, not as three position buckets.
 *  - `position-line`: no usable grid, so starters are grouped by their coarse
 *    position letter. Honest but coarser: a 4-2-3-1 and a 4-5-1 look alike.
 */
export type RowBasis = "formation-slot" | "position-line";

export type TeamSheet = {
  teamId: string;
  formation: string | null;
  starters: TeamSheetPlayer[];
  bench: TeamSheetPlayer[];
  /** Null when the data will not draw an honest pitch — the caller then
   * renders the list, never a guessed shape. */
  rows: TeamSheetRow[] | null;
  rowBasis: RowBasis | null;
};

function minuteOf(event: TeamSheetEvent): MatchMinute {
  return { minute: event.minute, added: event.addedTime };
}

/**
 * Formats a minute the way a scoreboard does: `63'`, `45+2'`.
 * Exported because the pitch, the bench list and the Ratings tab all print
 * one and must print it identically.
 */
export function formatMatchMinute(value: MatchMinute): string {
  return `${value.minute}${value.added ? `+${value.added}` : ""}'`;
}

/**
 * Buckets a Starting XI into pitch lines by the provider's own formation
 * slot. Returns null unless **every** starter carries a parsable `grid`,
 * because a pitch with two players missing from it is not a shape, it is a
 * mistake that looks authoritative.
 *
 * Rows come back furthest-forward first, because that is the order a pitch
 * is drawn in: the attack at the top of the card and the goalkeeper at the
 * bottom, the same top-to-bottom convention the fantasy squad pitch already
 * uses.
 *
 * Within a line, players keep the order the provider listed them in — the
 * column number is used to sort, but nothing here or in the UI claims that
 * column 1 is the left flank or the right one. That direction is genuinely
 * unpublished (see `parsePitchGrid`'s own note and
 * `heatmap/player-position-mapper.ts`'s `lateralConfidence: "provider-order"`,
 * which is the same decision made in the same codebase for the same reason),
 * and a pitch that confidently draws a right-back on the left is worse than
 * one that says nothing about flanks at all.
 */
export function pitchRowsFromGrid(starters: TeamSheetPlayer[], grids: Map<string, string | null>): TeamSheetRow[] | null {
  if (starters.length !== 11) return null;

  const byRow = new Map<number, { col: number; player: TeamSheetPlayer }[]>();
  for (const player of starters) {
    const parsed = parsePitchGrid(grids.get(player.playerId) ?? null);
    if (!parsed) return null;
    const bucket = byRow.get(parsed.row);
    if (bucket) bucket.push({ col: parsed.col, player });
    else byRow.set(parsed.row, [{ col: parsed.col, player }]);
  }

  // Row 1 is the goalkeeper's line. A team sheet that reports two players on
  // it, or none, is not one this can draw honestly.
  if ((byRow.get(1)?.length ?? 0) !== 1) return null;

  return [...byRow.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([row, slots]) => ({
      key: `row-${row}`,
      players: slots.sort((a, b) => a.col - b.col).map((slot) => slot.player),
    }));
}

const POSITION_LINE_ORDER = ["F", "M", "D", "G"] as const;
type PositionLine = (typeof POSITION_LINE_ORDER)[number];

/**
 * The fallback: bucket a Starting XI by each player's real synced position
 * letter. Returns null whenever the data will not draw a real pitch — fewer
 * or more than 11 starters, a letter that is not one of the four, or anything
 * but exactly one goalkeeper. This never guesses a missing player's position.
 *
 * Rows come back furthest-forward first, matching `pitchRowsFromGrid`, so the
 * two are interchangeable to the renderer.
 */
export function pitchRowsFromPositions(starters: TeamSheetPlayer[]): TeamSheetRow[] | null {
  if (starters.length !== 11) return null;

  const buckets: Record<PositionLine, TeamSheetPlayer[]> = { G: [], D: [], M: [], F: [] };
  for (const player of starters) {
    const letter = (player.position ?? "").trim().toUpperCase();
    if (letter !== "G" && letter !== "D" && letter !== "M" && letter !== "F") return null;
    buckets[letter].push(player);
  }
  if (buckets.G.length !== 1) return null;

  return POSITION_LINE_ORDER.map((key) => ({ key, players: buckets[key] })).filter((row) => row.players.length > 0);
}

/**
 * Pitch rows for a Starting XI, preferring the provider's own formation slots
 * and falling back to position letters. Null means "render the list instead".
 *
 * Kept as one entry point so the two callers (the Lineups tab deciding whether
 * *both* sides can draw a pitch, and the pitch itself) cannot disagree about
 * whether a given XI is drawable.
 */
export function buildPitchRows(
  starters: TeamSheetPlayer[],
  grids: Map<string, string | null>,
): { rows: TeamSheetRow[]; basis: RowBasis } | null {
  const fromGrid = pitchRowsFromGrid(starters, grids);
  if (fromGrid) return { rows: fromGrid, basis: "formation-slot" };
  const fromPositions = pitchRowsFromPositions(starters);
  if (fromPositions) return { rows: fromPositions, basis: "position-line" };
  return null;
}

/**
 * Builds one club's team sheet from the fixture's own lineup and event rows.
 *
 * `entries` and `events` may be the whole fixture's — both are filtered to
 * `teamId` here, so a caller never has to pre-slice and the two sides cannot
 * accidentally be built from differently-filtered inputs.
 *
 * Bench order is the provider's, unchanged, with one exception: substitutes
 * who actually came on are listed first, because "who did this manager
 * change" is the question a bench is read for. Unused substitutes keep their
 * own relative order after them.
 */
export function buildTeamSheet(teamId: string, entries: TeamSheetLineupEntry[], events: TeamSheetEvent[]): TeamSheet {
  const ours = entries.filter((entry) => entry.teamId === teamId);
  const ourEvents = events.filter((event) => event.teamId === teamId);

  const players = new Map<string, TeamSheetPlayer>();
  const grids = new Map<string, string | null>();
  const order: string[] = [];

  for (const entry of ours) {
    // A lineup row with no resolved player id cannot be matched to an event,
    // and two of them would collide in the map. Keyed by name in that case so
    // the player still appears on the sheet, just without event markers.
    const key = entry.playerId || `name:${entry.playerName}`;
    if (players.has(key)) continue;
    order.push(key);
    grids.set(key, entry.grid);
    players.set(key, {
      playerId: entry.playerId,
      playerName: entry.playerName,
      shirtNumber: entry.shirtNumber,
      position: entry.position,
      isStarting: entry.isStarting,
      goals: 0,
      ownGoals: 0,
      assists: 0,
      yellowCards: 0,
      redCards: 0,
      penaltiesMissed: 0,
      wentOff: null,
      cameOn: null,
    });
  }

  for (const event of ourEvents) {
    const subject = event.playerId ? players.get(event.playerId) : undefined;
    const related = event.relatedPlayerId ? players.get(event.relatedPlayerId) : undefined;

    switch (event.eventType) {
      case "goal":
      case "penalty_goal":
        if (subject) subject.goals += 1;
        if (related) related.assists += 1;
        break;
      case "own_goal":
        // Credited against the scorer's own team by the provider, so this
        // arrives on the team that conceded it. It is the player's own tally,
        // never a goal "for" them.
        if (subject) subject.ownGoals += 1;
        break;
      case "penalty_missed":
        if (subject) subject.penaltiesMissed += 1;
        break;
      case "yellow_card":
        if (subject) subject.yellowCards += 1;
        break;
      case "second_yellow_card":
        // Two facts in one event: the booking and the dismissal. Both are
        // counted, which is why a sent-off player reads "2 yellows, 1 red"
        // rather than losing one of them.
        if (subject) {
          subject.yellowCards += 1;
          subject.redCards += 1;
        }
        break;
      case "red_card":
        if (subject) subject.redCards += 1;
        break;
      case "substitution":
        // API-Football's own convention, documented in docs/API_FOOTBALL.md:
        // on a substitution the event's player is the one going OFF and the
        // assist slot holds the one coming ON.
        if (subject && subject.wentOff === null) subject.wentOff = minuteOf(event);
        if (related && related.cameOn === null) related.cameOn = minuteOf(event);
        break;
      case "var_review":
        // A review is a fact about the match, not about a player's line.
        break;
    }
  }

  const all = order.map((key) => players.get(key)!);
  const starters = all.filter((player) => player.isStarting);
  const bench = all
    .filter((player) => !player.isStarting)
    .sort((a, b) => Number(b.cameOn !== null) - Number(a.cameOn !== null));

  const pitch = buildPitchRows(starters, grids);

  return {
    teamId,
    formation: ours.find((entry) => entry.formation)?.formation ?? null,
    starters,
    bench,
    rows: pitch?.rows ?? null,
    rowBasis: pitch?.basis ?? null,
  };
}

/** True when this player has at least one real marker worth drawing on their
 * token — used by the pitch to decide whether to reserve badge space at all. */
export function hasMatchMarkers(player: TeamSheetPlayer): boolean {
  return (
    player.goals > 0 ||
    player.ownGoals > 0 ||
    player.assists > 0 ||
    player.yellowCards > 0 ||
    player.redCards > 0 ||
    player.wentOff !== null ||
    player.cameOn !== null
  );
}

/**
 * A short, screen-reader-first sentence describing everything that happened to
 * one player, built from the same counts the badges draw. Returns null when
 * nothing did, so callers can skip the element entirely rather than announce
 * an empty string.
 */
export function describePlayerMarkers(player: TeamSheetPlayer): string | null {
  const parts: string[] = [];
  if (player.goals > 0) parts.push(player.goals === 1 ? "1 goal" : `${player.goals} goals`);
  if (player.assists > 0) parts.push(player.assists === 1 ? "1 assist" : `${player.assists} assists`);
  if (player.ownGoals > 0) parts.push(player.ownGoals === 1 ? "1 own goal" : `${player.ownGoals} own goals`);
  if (player.penaltiesMissed > 0) {
    parts.push(player.penaltiesMissed === 1 ? "1 penalty missed" : `${player.penaltiesMissed} penalties missed`);
  }
  if (player.yellowCards > 0) parts.push(player.yellowCards === 1 ? "booked" : "two yellow cards");
  if (player.redCards > 0) parts.push("sent off");
  if (player.cameOn) parts.push(`on at ${formatMatchMinute(player.cameOn)}`);
  if (player.wentOff) parts.push(`off at ${formatMatchMinute(player.wentOff)}`);
  return parts.length > 0 ? parts.join(", ") : null;
}
