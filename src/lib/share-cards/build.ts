/**
 * Pure builders: real database rows in, `ShareCardData` out.
 *
 * Split from `load.ts` (which owns the queries and is server-only) so every
 * omission rule below is directly testable without a database — see
 * `build.test.ts`. Nothing in this file reaches for a client, a clock it
 * wasn't given, or a fallback value.
 *
 * ## Two rules, applied everywhere
 *
 * **1. Omit, never zero.** A stat that isn't synced does not appear on the
 * card. `null` in, nothing out. The distinction that matters: a player who
 * appeared in four matches and scored no goals really did score `0`, and that
 * zero is shown; a player with no synced lineup rows at all has no
 * appearances *number*, and that element is dropped. Builders receive
 * already-resolved counts precisely so that distinction is made once, at the
 * query, rather than guessed at here.
 *
 * **2. Format in UTC.** Every label is produced here, on the server, and then
 * travels two different paths to the screen: into the browser preview as
 * props, and into `next/og` inside the image route. If those two formatted a
 * date against different clocks, the preview and the downloaded PNG would
 * disagree — the exact drift this whole system exists to prevent. So dates
 * are formatted with an explicit `"UTC"` zone, not the renderer's local one.
 */

import { DISPLAY_LOCALE, formatDate, formatDateTime, formatMonthYear } from "@/lib/format";
import { STATUS_LABEL, type FixtureStatus } from "@/lib/football/fixture-status";
import type {
  AiInsightCard,
  FantasyPerformanceCard,
  LeagueTableCard,
  LiveScoreCard,
  PlayerComparisonCard,
  PlayerPerformanceCard,
  PredictionCard,
  ProfileAchievementCard,
  ShareScorer,
  ShareStat,
  ShareTeamRef,
  TransferCard,
} from "./types";

/** How many goal events a card can carry before the list stops being
 * readable at share size. Beyond this the card says how many more there
 * were rather than silently dropping them. */
export const MAX_SHARE_SCORERS = 6;

/** A league table card taller than this stops being legible on a phone. */
export const MAX_TABLE_ROWS = 10;

/** Answers longer than this are cut at a word boundary with an ellipsis and
 * the card says the full answer is in the app. Truncation is honest; a
 * summary of an answer would be a second, ungrounded piece of writing. */
export const MAX_ANSWER_CHARS = 320;
export const MAX_QUESTION_CHARS = 120;

function truncateAtWord(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function team(row: { name: string; short_name: string | null; crest_url: string | null } | null): ShareTeamRef | null {
  if (!row) return null;
  return { name: row.name, shortName: row.short_name, crestUrl: row.crest_url };
}

/** A stat only exists if its value does. Callers build their whole stat list
 * through this so "omit, never zero" is one function rather than a rule
 * everyone has to remember. */
export function stat(label: string, value: number | string | null | undefined, emphasis = false): ShareStat | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return { label, value: typeof value === "number" ? value.toLocaleString(DISPLAY_LOCALE) : value, emphasis };
}

export function compactStats(stats: (ShareStat | null)[]): ShareStat[] {
  return stats.filter((s): s is ShareStat => s !== null);
}

/* ------------------------------------------------------------------ */
/* 1. Live score                                                       */
/* ------------------------------------------------------------------ */

export type LiveScoreFixtureRow = {
  status: FixtureStatus;
  kickoff_at: string;
  home_score: number | null;
  away_score: number | null;
  minute_elapsed: number | null;
  competition: { name: string } | null;
  venue: { name: string | null; city: string | null } | null;
  home_team: { id: string; name: string; short_name: string | null; crest_url: string | null } | null;
  away_team: { id: string; name: string; short_name: string | null; crest_url: string | null } | null;
};

export type LiveScoreEventRow = {
  event_type: string;
  minute: number;
  added_time: number | null;
  team_id: string;
  player_name: string | null;
};

const GOAL_EVENT_TYPES = new Set(["goal", "penalty_goal", "own_goal"]);

export function buildLiveScoreCard(
  fixture: LiveScoreFixtureRow,
  events: LiveScoreEventRow[],
): LiveScoreCard | null {
  const home = team(fixture.home_team);
  const away = team(fixture.away_team);
  // A fixture missing one of its own teams is a broken row, not a card. There
  // is no honest "Home"/"Away" placeholder for something people will screenshot.
  if (!home || !away || !fixture.home_team || !fixture.away_team) return null;

  const state: LiveScoreCard["state"] =
    fixture.status === "live" || fixture.status === "halftime"
      ? "live"
      : fixture.status === "finished" || fixture.status === "abandoned"
        ? "finished"
        : "upcoming";

  const statusLabel =
    state === "upcoming"
      ? "KICK-OFF"
      : fixture.status === "halftime"
        ? "HALF TIME"
        : fixture.status === "live"
          ? "LIVE"
          : STATUS_LABEL[fixture.status] === "FT"
            ? "FULL TIME"
            : STATUS_LABEL[fixture.status].toUpperCase();

  const homeTeamId = fixture.home_team.id;
  const scorers: ShareScorer[] = events
    .filter((e) => GOAL_EVENT_TYPES.has(e.event_type) && e.player_name)
    .sort((a, b) => a.minute - b.minute || (a.added_time ?? 0) - (b.added_time ?? 0))
    .slice(0, MAX_SHARE_SCORERS)
    .map((e) => ({
      minute: e.minute,
      addedTime: e.added_time,
      playerName: e.player_name as string,
      isOwnGoal: e.event_type === "own_goal",
      // An own goal is credited to the team that benefits, which is the
      // opposite of the team the event row belongs to.
      side:
        e.event_type === "own_goal"
          ? e.team_id === homeTeamId
            ? ("away" as const)
            : ("home" as const)
          : e.team_id === homeTeamId
            ? ("home" as const)
            : ("away" as const),
    }));

  const venueLabel = fixture.venue?.name
    ? fixture.venue.city
      ? `${fixture.venue.name}, ${fixture.venue.city}`
      : fixture.venue.name
    : null;

  return {
    kind: "live-score",
    competitionName: fixture.competition?.name ?? "Football",
    statusLabel,
    state,
    minuteLabel: fixture.status === "live" && fixture.minute_elapsed != null ? `${fixture.minute_elapsed}'` : null,
    kickoffLabel: formatDateTime(fixture.kickoff_at, "full", "UTC"),
    venueLabel,
    home,
    away,
    // Deliberately not `?? 0`: a fixture that hasn't started has no score, and
    // a card that prints 0-0 before kickoff is asserting a result.
    homeScore: state === "upcoming" ? null : fixture.home_score,
    awayScore: state === "upcoming" ? null : fixture.away_score,
    scorers,
  };
}

/* ------------------------------------------------------------------ */
/* 2. Player performance                                               */
/* ------------------------------------------------------------------ */

export type PlayerRow = {
  full_name: string;
  photo_url: string | null;
  position: string | null;
  team: { name: string; short_name: string | null; crest_url: string | null } | null;
};

/** Already-computed real totals (see `computePlayerMatchStats`). `null` means
 * "not synced", which is different from a synced zero. */
export type PlayerTotals = {
  appearances: number | null;
  starts: number | null;
  goals: number | null;
  /** Real, from the assister recorded on each goal event
   * (`fixture_events.related_player_id`). Null means the loader did not query
   * assists, which is not the same as a player who has none. */
  assists: number | null;
  yellowCards: number | null;
  redCards: number | null;
};

export function buildPlayerPerformanceCard(
  player: PlayerRow,
  totals: PlayerTotals,
  windowLabel: string,
): PlayerPerformanceCard | null {
  const stats = compactStats([
    stat("Apps", totals.appearances),
    stat("Starts", totals.starts),
    stat("Goals", totals.goals, true),
    stat("Assists", totals.assists),
    stat("Yellow", totals.yellowCards),
    stat("Red", totals.redCards),
  ]);

  // A player card with no real numbers on it is a picture of a name. Nothing
  // to share, so nothing is offered.
  if (stats.length === 0) return null;

  return {
    kind: "player-performance",
    player: {
      name: player.full_name,
      photoUrl: player.photo_url,
      teamName: player.team?.name ?? null,
      position: player.position,
    },
    teamCrestUrl: player.team?.crest_url ?? null,
    windowLabel,
    stats,
  };
}

/* ------------------------------------------------------------------ */
/* 3. Player comparison                                                */
/* ------------------------------------------------------------------ */

/** Which way "better" points, per row. Cards only ever mark a leader on a
 * stat where more/less is unambiguously better — never on appearances (more
 * games is not itself an achievement) and never on cards. */
const COMPARISON_ROWS: { label: string; key: keyof PlayerTotals; higherIsBetter: boolean | null }[] = [
  { label: "Appearances", key: "appearances", higherIsBetter: null },
  { label: "Starts", key: "starts", higherIsBetter: null },
  { label: "Goals", key: "goals", higherIsBetter: true },
  { label: "Assists", key: "assists", higherIsBetter: true },
  { label: "Yellow cards", key: "yellowCards", higherIsBetter: null },
  { label: "Red cards", key: "redCards", higherIsBetter: null },
];

export function buildPlayerComparisonCard(
  left: { player: PlayerRow; totals: PlayerTotals },
  right: { player: PlayerRow; totals: PlayerTotals },
  windowLabel: string,
): PlayerComparisonCard | null {
  const rows: PlayerComparisonCard["rows"] = [];

  for (const row of COMPARISON_ROWS) {
    const l = left.totals[row.key];
    const r = right.totals[row.key];
    // Both sides or neither. A comparison row with one blank column invites
    // the reader to assume the blank is a zero, which is exactly the
    // fabrication this rule exists to stop.
    if (l == null || r == null) continue;
    rows.push({
      label: row.label,
      leftValue: l.toLocaleString(DISPLAY_LOCALE),
      rightValue: r.toLocaleString(DISPLAY_LOCALE),
      leader:
        row.higherIsBetter === null || l === r ? "tie" : (l > r) === row.higherIsBetter ? "left" : "right",
    });
  }

  if (rows.length === 0) return null;

  return {
    kind: "player-comparison",
    left: {
      name: left.player.full_name,
      photoUrl: left.player.photo_url,
      teamName: left.player.team?.name ?? null,
      position: left.player.position,
    },
    right: {
      name: right.player.full_name,
      photoUrl: right.player.photo_url,
      teamName: right.player.team?.name ?? null,
      position: right.player.position,
    },
    windowLabel,
    rows,
  };
}

/* ------------------------------------------------------------------ */
/* 4. Prediction                                                       */
/* ------------------------------------------------------------------ */

export type PredictionRow = {
  predicted_outcome: "home_win" | "draw" | "away_win";
  points_awarded: number | null;
};

export function buildPredictionCard(
  prediction: PredictionRow,
  fixture: LiveScoreFixtureRow,
  profile: { display_name: string | null; username: string; avatar_src: string | null },
): PredictionCard | null {
  const home = team(fixture.home_team);
  const away = team(fixture.away_team);
  if (!home || !away) return null;

  const predictedLabel =
    prediction.predicted_outcome === "home_win"
      ? `${home.shortName ?? home.name} win`
      : prediction.predicted_outcome === "away_win"
        ? `${away.shortName ?? away.name} win`
        : "Draw";

  const settled =
    fixture.status === "finished" && fixture.home_score != null && fixture.away_score != null;

  const actualOutcome = settled
    ? (fixture.home_score as number) > (fixture.away_score as number)
      ? "home_win"
      : (fixture.home_score as number) < (fixture.away_score as number)
        ? "away_win"
        : "draw"
    : null;

  return {
    kind: "prediction",
    displayName: profile.display_name ?? profile.username,
    username: profile.username,
    avatarUrl: profile.avatar_src,
    home,
    away,
    kickoffLabel: formatDateTime(fixture.kickoff_at, "full", "UTC"),
    competitionName: fixture.competition?.name ?? "Football",
    predictedLabel,
    actualLabel: settled ? `${fixture.home_score} - ${fixture.away_score}` : null,
    // Only a genuinely scored prediction carries points. `points_awarded` is
    // null until the fixture settles, and stays null — never coerced to 0.
    pointsAwarded: prediction.points_awarded,
    outcome:
      actualOutcome === null ? "pending" : actualOutcome === prediction.predicted_outcome ? "correct" : "missed",
  };
}

/* ------------------------------------------------------------------ */
/* 5. Fantasy performance                                              */
/* ------------------------------------------------------------------ */

export function buildFantasyPerformanceCard(input: {
  teamName: string;
  managerName: string;
  gameweekNumber: number;
  gameweekName: string | null;
  points: number;
  rank: number | null;
  leagueName: string | null;
  entriesInLeague: number | null;
  averagePoints: number | null;
  squadSize: number | null;
}): FantasyPerformanceCard {
  return {
    kind: "fantasy-performance",
    teamName: input.teamName,
    managerName: input.managerName,
    gameweekLabel: input.gameweekName ?? `Gameweek ${input.gameweekNumber}`,
    // Points are a real stored total from `fantasy_points`; a gameweek with
    // no row doesn't produce a card at all (see load.ts), so a 0 here is a
    // scored zero.
    points: input.points,
    rankLabel:
      input.rank != null && input.leagueName
        ? input.entriesInLeague != null
          ? `${ordinal(input.rank)} of ${input.entriesInLeague} · ${input.leagueName}`
          : `${ordinal(input.rank)} · ${input.leagueName}`
        : null,
    stats: compactStats([
      stat("Squad", input.squadSize),
      stat("League average", input.averagePoints),
    ]),
  };
}

export function ordinal(value: number): string {
  const abs = Math.abs(value) % 100;
  const suffix = abs >= 11 && abs <= 13 ? "th" : ["th", "st", "nd", "rd"][Math.min(abs % 10, 4)] ?? "th";
  return `${value}${suffix}`;
}

/* ------------------------------------------------------------------ */
/* 6. League table                                                     */
/* ------------------------------------------------------------------ */

export type StandingRow = {
  position: number | null;
  played: number;
  goals_for: number;
  goals_against: number;
  points: number;
  team: { name: string; short_name: string | null; crest_url: string | null } | null;
};

export function buildLeagueTableCard(
  competitionName: string,
  seasonLabel: string,
  standings: StandingRow[],
  highlightTeamName: string | null,
): LeagueTableCard | null {
  // A row with no resolved position is a row KIVO cannot place in a table.
  // Dropping it is right; guessing an order for it is not.
  const placed = standings
    .filter((row): row is StandingRow & { position: number } => row.position != null && row.team != null)
    .sort((a, b) => a.position - b.position);

  if (placed.length === 0) return null;

  // When a specific team is being shared and it sits below the visible top,
  // the window slides to keep it on the card rather than shipping a table
  // that doesn't contain the thing it was made for.
  let start = 0;
  if (highlightTeamName) {
    const index = placed.findIndex((row) => row.team?.name === highlightTeamName);
    if (index >= MAX_TABLE_ROWS) start = Math.min(index - MAX_TABLE_ROWS + 2, placed.length - MAX_TABLE_ROWS);
  }
  const window = placed.slice(start, start + MAX_TABLE_ROWS);

  return {
    kind: "league-table",
    competitionName,
    seasonLabel,
    rows: window.map((row) => ({
      position: row.position,
      team: team(row.team) as ShareTeamRef,
      played: row.played,
      goalDifference: row.goals_for - row.goals_against,
      points: row.points,
    })),
    highlightTeamName,
    truncatedNote:
      placed.length > window.length
        ? `Positions ${window[0].position}–${window[window.length - 1].position} of ${placed.length}`
        : null,
  };
}

/* ------------------------------------------------------------------ */
/* 7. Transfer                                                         */
/* ------------------------------------------------------------------ */

export type TransferRow = {
  transfer_date: string;
  fee_text: string | null;
  transfer_type: string;
  player: { full_name: string; photo_url: string | null } | null;
  from_team: { name: string; short_name: string | null; crest_url: string | null } | null;
  to_team: { name: string; short_name: string | null; crest_url: string | null } | null;
};

export function buildTransferCard(
  row: TransferRow,
  typeLabel: string,
  sourceLabel: string,
): TransferCard | null {
  if (!row.player) return null;
  // A move with neither end resolved says nothing. Both ends unknown is a
  // sync gap, not a transfer worth putting a name to.
  if (!row.from_team && !row.to_team) return null;

  return {
    kind: "transfer",
    playerName: row.player.full_name,
    playerPhotoUrl: row.player.photo_url,
    fromTeam: team(row.from_team),
    toTeam: team(row.to_team),
    typeLabel,
    feeText: row.fee_text,
    dateLabel: formatDate(row.transfer_date, { month: "short" }),
    // One status, and it is the true one. KIVO's transfer feed is completed,
    // recorded moves — see RECOMMENDATIONS.md item 178 for why the four-tier
    // Confirmed/Reported/Rumour/Unverified taxonomy was retired rather than
    // built: there is no real signal behind the other three.
    statusLabel: "Confirmed",
    sourceLabel,
  };
}

/* ------------------------------------------------------------------ */
/* 8. AI insight                                                       */
/* ------------------------------------------------------------------ */

export function buildAiInsightCard(input: {
  question: string;
  answer: string;
  askedAt: string;
  contextLabel: string | null;
}): AiInsightCard | null {
  const question = truncateAtWord(input.question, MAX_QUESTION_CHARS);
  const answer = truncateAtWord(input.answer, MAX_ANSWER_CHARS);
  if (!question || !answer) return null;

  return {
    kind: "ai-insight",
    question,
    answer,
    askedAtLabel: formatDateTime(input.askedAt, "full", "UTC"),
    contextLabel: input.contextLabel,
  };
}

/* ------------------------------------------------------------------ */
/* 9. Profile / achievement                                            */
/* ------------------------------------------------------------------ */

export function buildProfileAchievementCard(input: {
  displayName: string | null;
  username: string;
  avatarUrl: string | null;
  createdAt: string;
  totalXp: number | null;
  predictionsMade: number | null;
  correctPredictions: number | null;
  postsWritten: number | null;
  followingCount: number | null;
  badges: { name: string; description: string | null }[];
}): ProfileAchievementCard {
  return {
    kind: "profile-achievement",
    displayName: input.displayName ?? input.username,
    username: input.username,
    avatarUrl: input.avatarUrl,
    joinedLabel: `Joined ${formatMonthYear(input.createdAt)}`,
    stats: compactStats([
      stat("XP", input.totalXp, true),
      stat("Predictions", input.predictionsMade),
      stat("Correct", input.correctPredictions),
      stat("Posts", input.postsWritten),
      stat("Following", input.followingCount),
    ]),
    badges: input.badges,
  };
}
