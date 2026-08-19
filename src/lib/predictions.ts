import { CheckCircle2, Clock, HelpCircle, MinusCircle, XCircle, type LucideIcon } from "lucide-react";
import type { FixtureStatus } from "@/lib/football/fixture-status";

// Shared between the admin scoring action and the Data Health page's copy —
// a "use server" file may only export async functions, so these live here
// rather than alongside scorePredictions() in predictions-actions.ts.
export const CORRECT_PREDICTION_POINTS = 3;
export const CORRECT_PREDICTION_XP = 15;

export type PredictionOutcome = "home_win" | "draw" | "away_win";

// Shared between the prediction card (picking an outcome) and the "my
// predictions" history view (showing what was picked) so the label for a
// given outcome never drifts between the two.
export const PREDICTION_OUTCOME_LABEL: Record<PredictionOutcome, string> = {
  home_win: "Home",
  draw: "Draw",
  away_win: "Away",
};

export type StreakSummary = { current: number; best: number };

/**
 * RECOMMENDATIONS.md item 169: current and best runs of consecutive correct
 * predictions, derived purely from a user's own scored predictions
 * (points_awarded not null) ordered by the fixture's real kickoff_at — not
 * created_at, since a prediction can be made well before, or shortly before,
 * a fixture it doesn't necessarily rank chronologically against other
 * predictions by submission time. "Correct" means points_awarded > 0, the
 * same definition /predictions/mine and scorePredictions already use for
 * accuracy, so streak and accuracy can never quietly disagree about what
 * counts as a hit.
 *
 * Shared by /predictions/mine (display) and scorePredictions
 * (predictions-actions.ts, badge award criteria for three_prediction_streak)
 * so the two can't drift into different definitions of "streak".
 */
export function computeStreaks(scoredRows: { pointsAwarded: number; kickoffAt: string }[]): StreakSummary {
  const chronological = [...scoredRows].sort(
    (a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime(),
  );

  // A single forward pass gets both numbers: `running` resets to 0 on every
  // miss and otherwise accumulates, so its value after the last row is
  // exactly the trailing run counting back from the most recently kicked-off
  // scored prediction — i.e. the current streak — while `best` tracks the
  // longest run `running` ever reached along the way.
  let best = 0;
  let running = 0;
  for (const row of chronological) {
    if (row.pointsAwarded > 0) {
      running += 1;
      best = Math.max(best, running);
    } else {
      running = 0;
    }
  }

  return { current: running, best };
}

export type PredictionResultInfo = { label: string; className: string; icon: LucideIcon };

/**
 * A prediction's result, purely from real columns — `points_awarded` is null
 * until the admin scoring pass (predictions-actions.ts's scorePredictions)
 * resolves it, so "not scored yet" is shown honestly rather than as a 0 or a
 * guessed outcome. Never derives correctness from the fixture score
 * directly: `points_awarded` is the single source of truth for what was
 * actually graded, same as the leaderboard.
 *
 * Shared between /predictions/mine (where this was originally defined) and
 * Match Centre's "You predicted" card (RECOMMENDATIONS.md item 293) so the
 * two can never disagree about what a given prediction row's result reads
 * as — the exact "reuse /predictions/mine's existing result-formatting"
 * item 293 itself calls for, rather than a second, possibly-drifting copy.
 */
export function predictionResultInfo(
  status: FixtureStatus,
  pointsAwarded: number | null,
  /** Migration 0079's third answer. "unresolvable" is not a miss and must
   * never render as one: the data this prediction needed was never synced,
   * which is KIVO's gap and not the user's. `unresolvableReason` is the
   * scoring pass's own plain-language sentence, shown verbatim. */
  resolution: PredictionResolution | null = null,
  unresolvableReason: string | null = null,
): PredictionResultInfo {
  if (resolution === "unresolvable") {
    return {
      label: unresolvableReason ?? "KIVO couldn't settle this one",
      className: "text-warning",
      icon: HelpCircle,
    };
  }
  if (pointsAwarded !== null) {
    return pointsAwarded > 0
      ? { label: `Correct · +${pointsAwarded} pts`, className: "text-live", icon: CheckCircle2 }
      : { label: "Incorrect", className: "text-critical", icon: XCircle };
  }
  if (status === "finished") {
    return { label: "Not scored yet", className: "text-foreground-subtle", icon: Clock };
  }
  if (status === "postponed" || status === "cancelled" || status === "abandoned") {
    return { label: "No result", className: "text-foreground-subtle", icon: MinusCircle };
  }
  return { label: "Pending", className: "text-foreground-subtle", icon: Clock };
}

/* ---------------------------------------------------------------------------
   THE SIX PREDICTION TYPES

   The founding brief names six kinds of prediction — winner, correct score,
   first scorer, total goals, cards & corners, man of the match — and KIVO
   shipped one. The other five needed no new provider call: every fact they
   turn on is already in KIVO's own tables (fixtures' final score,
   fixture_events' goals and cards, fixture_statistics' corners, and — for
   MOTM, which no provider in KIVO's stack reports at all — the Room's own
   vote, made resolvable by migration 0078's real player-linked poll options).

   Everything below is pure. It takes the facts KIVO actually holds and
   returns a verdict; it never queries, and it never guesses. The one rule it
   exists to enforce is that "KIVO does not know" is a real answer with its
   own name, distinct from "you were wrong" — see PredictionVerdict.
--------------------------------------------------------------------------- */

export const PREDICTION_TYPES = [
  "winner",
  "correct_score",
  "first_scorer",
  "total_goals",
  "cards_corners",
  "motm",
] as const;

export type PredictionType = (typeof PREDICTION_TYPES)[number];

export type TotalGoalsBand = "goals_0_1" | "goals_2_3" | "goals_4_plus";
export type CardsBand = "cards_0_2" | "cards_3_4" | "cards_5_plus";
export type CornersBand = "corners_0_8" | "corners_9_12" | "corners_13_plus";

/**
 * Points per type, and the reason they differ.
 *
 * `winner` stays at CORRECT_PREDICTION_POINTS — the value it has always had —
 * so nobody's existing total changes meaning the day this ships. The other
 * five are priced by how hard they actually are to call, not by how
 * interesting they are: a scoreline is the hardest thing on this list and a
 * goals band is barely harder than a winner pick.
 *
 * Versioned TS constants rather than DB config, matching how fantasy scoring
 * already works here (see DECISIONS.md) — honest, greppable, and a deploy to
 * change, which is the right friction for a number that alters a leaderboard.
 */
export const PREDICTION_TYPE_POINTS: Record<PredictionType, number> = {
  winner: CORRECT_PREDICTION_POINTS,
  correct_score: 6,
  first_scorer: 5,
  motm: 4,
  total_goals: 3,
  cards_corners: 3,
};

/**
 * XP per correct prediction, at the exact ratio the winner type already used
 * (CORRECT_PREDICTION_XP / CORRECT_PREDICTION_POINTS = 5), so the XP model is
 * extended rather than replaced and `winner` produces byte-identical XP to
 * what it produced yesterday.
 */
export const XP_PER_PREDICTION_POINT = CORRECT_PREDICTION_XP / CORRECT_PREDICTION_POINTS;

export function predictionXp(type: PredictionType): number {
  return PREDICTION_TYPE_POINTS[type] * XP_PER_PREDICTION_POINT;
}

export const PREDICTION_TYPE_LABEL: Record<PredictionType, string> = {
  winner: "Winner",
  correct_score: "Correct score",
  first_scorer: "First scorer",
  total_goals: "Total goals",
  cards_corners: "Cards & corners",
  motm: "Man of the match",
};

/**
 * What each type is settled against, in the user's own words. Shown next to
 * the picker, because a fan is entitled to know what will decide their
 * prediction before they make it — particularly for the two types whose
 * source is not the scoreline.
 */
export const PREDICTION_TYPE_SOURCE: Record<PredictionType, string> = {
  winner: "Settled by the final score.",
  correct_score: "Settled by the final score. Exact — 2-1 is not 3-1.",
  first_scorer: "Settled by KIVO's synced match events. Own goals don't count as a first scorer.",
  total_goals: "Settled by the final score, both teams combined.",
  cards_corners: "Settled by the match statistics feed. Both bands must be right.",
  motm: "Settled by this match's Room vote — KIVO has no provider man-of-the-match award, so the room's own vote is the only real answer there is.",
};

export const TOTAL_GOALS_BAND_LABEL: Record<TotalGoalsBand, string> = {
  goals_0_1: "0-1 goals",
  goals_2_3: "2-3 goals",
  goals_4_plus: "4+ goals",
};

export const CARDS_BAND_LABEL: Record<CardsBand, string> = {
  cards_0_2: "0-2 cards",
  cards_3_4: "3-4 cards",
  cards_5_plus: "5+ cards",
};

export const CORNERS_BAND_LABEL: Record<CornersBand, string> = {
  corners_0_8: "0-8 corners",
  corners_9_12: "9-12 corners",
  corners_13_plus: "13+ corners",
};

// The band boundaries, in one place, mirroring migration 0079's enum values.
export function totalGoalsBand(totalGoals: number): TotalGoalsBand {
  if (totalGoals <= 1) return "goals_0_1";
  if (totalGoals <= 3) return "goals_2_3";
  return "goals_4_plus";
}

export function cardsBand(totalCards: number): CardsBand {
  if (totalCards <= 2) return "cards_0_2";
  if (totalCards <= 4) return "cards_3_4";
  return "cards_5_plus";
}

export function cornersBand(totalCorners: number): CornersBand {
  if (totalCorners <= 8) return "corners_0_8";
  if (totalCorners <= 12) return "corners_9_12";
  return "corners_13_plus";
}

/**
 * A man-of-the-match vote only means something once enough people have cast
 * one. Five is the same order of magnitude as MIN_MEANINGFUL_SAMPLE on the
 * consensus bar (3) and deliberately a little higher, because this number
 * settles a prediction rather than decorating a card — one person's opinion
 * must never become the fact that costs somebody else their points.
 */
export const MIN_MOTM_VOTES = 5;

/** One user's pick, in whatever shape its type requires. */
export type PredictionPick = {
  type: PredictionType;
  outcome: PredictionOutcome | null;
  homeScore: number | null;
  awayScore: number | null;
  playerId: string | null;
  totalGoals: TotalGoalsBand | null;
  cards: CardsBand | null;
  corners: CornersBand | null;
};

/**
 * Everything KIVO actually knows about a finished fixture, with `null` used
 * strictly to mean "not synced" — never "zero". That distinction is the whole
 * point of this type: `events: []` says KIVO synced this match's events and
 * there were none; `events: null` says KIVO has never synced them, and a
 * prediction that depends on them cannot be settled.
 */
export type FixtureFacts = {
  homeScore: number;
  awayScore: number;
  /** Real fixture_events rows, or null when none have ever been synced. */
  events: FixtureFactEvent[] | null;
  /** Both teams' fixture_statistics rows, or null when they aren't synced. */
  statistics: FixtureFactStatistics | null;
  /** The Room's man-of-the-match vote, or null when no such poll exists. */
  motm: MotmVote | null;
};

export type FixtureFactEvent = {
  eventType: string;
  minute: number;
  addedTime: number | null;
  playerId: string | null;
};

export type FixtureFactStatistics = {
  /** Null for any figure the provider didn't report — never coerced to 0. */
  totalCards: number | null;
  totalCorners: number | null;
};

export type MotmVote = {
  /** The winning option's real player, or null when it wasn't a linked player. */
  playerId: string | null;
  totalVotes: number;
  /** True when the top two options are level — no winner, honestly. */
  tied: boolean;
};

export type PredictionResolution = "correct" | "incorrect" | "unresolvable";

export type PredictionVerdict = {
  resolution: PredictionResolution;
  /** Null for "unresolvable" — an unsettleable prediction must cost nothing. */
  points: number | null;
  /** Plain-language reason, set only when unresolvable. */
  reason: string | null;
};

function correct(type: PredictionType, hit: boolean): PredictionVerdict {
  return hit
    ? { resolution: "correct", points: PREDICTION_TYPE_POINTS[type], reason: null }
    : { resolution: "incorrect", points: 0, reason: null };
}

function unresolvable(reason: string): PredictionVerdict {
  return { resolution: "unresolvable", points: null, reason };
}

/** Real outcome from a real final score. */
export function outcomeFromScore(homeScore: number, awayScore: number): PredictionOutcome {
  if (homeScore > awayScore) return "home_win";
  if (awayScore > homeScore) return "away_win";
  return "draw";
}

// Which event types genuinely credit a scorer. `own_goal` is deliberately
// excluded: it puts a goal on the scoreboard without anyone scoring for their
// own side, and crediting it as a "first scorer" would mean settling the
// prediction against a player who was trying to do the opposite.
const SCORING_EVENT_TYPES = new Set(["goal", "penalty_goal"]);

/** Every event that changed the scoreline, own goals included — used only to
 * check whether the event feed is complete enough to trust. */
const SCORELINE_EVENT_TYPES = new Set(["goal", "penalty_goal", "own_goal"]);

function eventClock(event: FixtureFactEvent): number {
  return event.minute * 100 + (event.addedTime ?? 0);
}

/**
 * Settles one prediction against what KIVO really holds.
 *
 * Every branch that cannot reach a fact returns `unresolvable` with a reason
 * a person can read, rather than an "incorrect" it cannot justify. That
 * asymmetry is deliberate and it is the honest one: being told "we couldn't
 * settle this" costs a user nothing, and being told "you were wrong" when
 * KIVO simply never synced the evidence costs them points they may have
 * earned.
 */
export function resolvePrediction(pick: PredictionPick, facts: FixtureFacts): PredictionVerdict {
  switch (pick.type) {
    case "winner": {
      if (pick.outcome === null) return unresolvable("This prediction is missing the pick it was saved with.");
      return correct("winner", pick.outcome === outcomeFromScore(facts.homeScore, facts.awayScore));
    }

    case "correct_score": {
      if (pick.homeScore === null || pick.awayScore === null) {
        return unresolvable("This prediction is missing the scoreline it was saved with.");
      }
      return correct("correct_score", pick.homeScore === facts.homeScore && pick.awayScore === facts.awayScore);
    }

    case "total_goals": {
      if (pick.totalGoals === null) return unresolvable("This prediction is missing the band it was saved with.");
      return correct("total_goals", pick.totalGoals === totalGoalsBand(facts.homeScore + facts.awayScore));
    }

    case "first_scorer": {
      if (pick.playerId === null) return unresolvable("This prediction is missing the player it was saved with.");
      if (facts.events === null) {
        return unresolvable("KIVO hasn't synced this match's events, so it can't say who scored first.");
      }

      const scorelineEvents = facts.events.filter((e) => SCORELINE_EVENT_TYPES.has(e.eventType));
      const totalGoals = facts.homeScore + facts.awayScore;

      if (scorelineEvents.length === 0) {
        // A 0-0 with a synced event feed is a real answer: nobody scored, so
        // every named scorer was wrong. A 2-1 with no goal events is a feed
        // that disagrees with its own scoreline, and KIVO will not settle a
        // prediction on data it can see is incomplete.
        if (totalGoals === 0) return correct("first_scorer", false);
        return unresolvable("This match's goals aren't in KIVO's event feed yet, so the first scorer can't be confirmed.");
      }

      const sorted = [...scorelineEvents].sort((a, b) => eventClock(a) - eventClock(b));
      const firstScoring = sorted.find((e) => SCORING_EVENT_TYPES.has(e.eventType));
      if (!firstScoring) {
        // Every goal in the match was an own goal. Nobody scored a first goal
        // for their own side, so no named player can be right.
        return correct("first_scorer", false);
      }
      if (firstScoring.playerId === null) {
        return unresolvable("The first goal is synced without a scorer, so KIVO can't settle this honestly.");
      }
      return correct("first_scorer", pick.playerId === firstScoring.playerId);
    }

    case "cards_corners": {
      if (pick.cards === null || pick.corners === null) {
        return unresolvable("This prediction is missing the bands it was saved with.");
      }
      if (facts.statistics === null) {
        return unresolvable("KIVO hasn't synced this match's team statistics, so cards and corners can't be counted.");
      }
      const { totalCards, totalCorners } = facts.statistics;
      if (totalCards === null || totalCorners === null) {
        return unresolvable("The provider didn't report cards or corners for this match, so this can't be settled.");
      }
      // Both halves must land. Said plainly on the picker (see
      // PREDICTION_TYPE_SOURCE) so it is a known rule rather than a surprise.
      return correct(
        "cards_corners",
        pick.cards === cardsBand(totalCards) && pick.corners === cornersBand(totalCorners),
      );
    }

    case "motm": {
      if (pick.playerId === null) return unresolvable("This prediction is missing the player it was saved with.");
      if (facts.motm === null) {
        return unresolvable("No man-of-the-match vote was held in this match's Room, so there's no result to settle against.");
      }
      if (facts.motm.totalVotes < MIN_MOTM_VOTES) {
        return unresolvable(
          `Only ${facts.motm.totalVotes} ${facts.motm.totalVotes === 1 ? "person" : "people"} voted for man of the match — too few to settle a prediction on.`,
        );
      }
      if (facts.motm.tied) {
        return unresolvable("The Room's man-of-the-match vote tied, so there's no single winner to settle against.");
      }
      if (facts.motm.playerId === null) {
        return unresolvable("The Room's winning pick isn't linked to a player in KIVO's squad data, so it can't be matched to a prediction.");
      }
      return correct("motm", pick.playerId === facts.motm.playerId);
    }
  }
}

/**
 * Reduces the raw per-option counts `get_motm_poll_result` returns into the
 * one thing a resolver needs. Kept here, not in SQL, because "enough votes"
 * and "a tie is not a winner" are judgement calls that deserve to be readable.
 */
export function motmVoteFromOptions(
  options: { player_id: string | null; vote_count: number }[],
): MotmVote | null {
  if (options.length === 0) return null;

  const totalVotes = options.reduce((sum, option) => sum + option.vote_count, 0);
  const ranked = [...options].sort((a, b) => b.vote_count - a.vote_count);
  const top = ranked[0];
  const runnerUp = ranked[1];

  return {
    playerId: top.vote_count > 0 ? top.player_id : null,
    totalVotes,
    tied: top.vote_count === 0 || (runnerUp !== undefined && runnerUp.vote_count === top.vote_count),
  };
}

/**
 * What a user actually picked, in one line, for whichever of the six types
 * this row is.
 *
 * Shared by /predictions/mine, /profile and Match Centre's "You predicted"
 * card for the same reason `predictionResultInfo` is: three surfaces that
 * describe the same row must not each invent their own wording, and with six
 * types instead of one the cost of that drift went up sixfold.
 *
 * `playerName` is passed in rather than looked up because a prediction row
 * carries only `predicted_player_id` — the caller already joined `players` for
 * the display it is building. When it is absent the description says so
 * honestly rather than printing a UUID or an empty string.
 */
export function describePredictionPick(pick: PredictionPick, playerName?: string | null): string {
  switch (pick.type) {
    case "winner":
      return pick.outcome ? PREDICTION_OUTCOME_LABEL[pick.outcome] : "—";
    case "correct_score":
      return pick.homeScore !== null && pick.awayScore !== null ? `${pick.homeScore}-${pick.awayScore}` : "—";
    case "total_goals":
      return pick.totalGoals ? TOTAL_GOALS_BAND_LABEL[pick.totalGoals] : "—";
    case "cards_corners":
      return pick.cards && pick.corners
        ? `${CARDS_BAND_LABEL[pick.cards]} · ${CORNERS_BAND_LABEL[pick.corners]}`
        : "—";
    case "first_scorer":
    case "motm":
      return playerName || "A player no longer in KIVO's squad data";
  }
}

/**
 * Builds a `PredictionPick` from a raw `predictions` row. One place where the
 * database's column names meet this module's vocabulary, so a renamed column
 * is a single compile error rather than six subtly-wrong call sites.
 */
export function pickFromRow(row: {
  prediction_type: PredictionType;
  predicted_outcome: PredictionOutcome | null;
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  predicted_player_id: string | null;
  predicted_total_goals: TotalGoalsBand | null;
  predicted_cards: CardsBand | null;
  predicted_corners: CornersBand | null;
}): PredictionPick {
  return {
    type: row.prediction_type,
    outcome: row.predicted_outcome,
    homeScore: row.predicted_home_score,
    awayScore: row.predicted_away_score,
    playerId: row.predicted_player_id,
    totalGoals: row.predicted_total_goals,
    cards: row.predicted_cards,
    corners: row.predicted_corners,
  };
}

/** The columns every consumer of `describePredictionPick` must select. Kept as
 * a string constant so the six-type payload can't be half-selected on one
 * surface and fully selected on another. */
export const PREDICTION_PICK_COLUMNS =
  "prediction_type, predicted_outcome, predicted_home_score, predicted_away_score, predicted_player_id, predicted_total_goals, predicted_cards, predicted_corners, resolution, unresolvable_reason";
