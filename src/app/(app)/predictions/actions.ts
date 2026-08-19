"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  PREDICTION_PICK_COLUMNS,
  pickFromRow,
  type CardsBand,
  type CornersBand,
  type PredictionOutcome,
  type PredictionPick,
  type PredictionType,
  type TotalGoalsBand,
} from "@/lib/predictions";
import { logError } from "@/lib/log";

/**
 * One submission, in whichever shape its type actually needs.
 *
 * A discriminated union rather than a bag of optional fields, for the same
 * reason migration 0079 has `predictions_payload_matches_type`: a
 * correct-score submission carrying no scoreline should be impossible to
 * express, not merely rejected at the end of a validation function.
 */
export type PredictionSubmission =
  | { type: "winner"; outcome: PredictionOutcome }
  | { type: "correct_score"; homeScore: number; awayScore: number }
  | { type: "first_scorer"; playerId: string }
  | { type: "total_goals"; band: TotalGoalsBand }
  | { type: "cards_corners"; cards: CardsBand; corners: CornersBand }
  | { type: "motm"; playerId: string };

type PredictionRowPayload = {
  prediction_type: PredictionType;
  predicted_outcome: PredictionOutcome | null;
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  predicted_player_id: string | null;
  predicted_total_goals: TotalGoalsBand | null;
  predicted_cards: CardsBand | null;
  predicted_corners: CornersBand | null;
};

const EMPTY_PAYLOAD = {
  predicted_outcome: null,
  predicted_home_score: null,
  predicted_away_score: null,
  predicted_player_id: null,
  predicted_total_goals: null,
  predicted_cards: null,
  predicted_corners: null,
} as const;

/**
 * Every other column is explicitly nulled, not just left out. An upsert that
 * only sets the columns its own type uses would leave a previous pick's
 * payload behind when a user changes their mind about *which* type they are
 * predicting — and a row carrying both a scoreline and a scorer is a row the
 * scoring pass has no honest way to read.
 */
function rowPayload(submission: PredictionSubmission): PredictionRowPayload {
  switch (submission.type) {
    case "winner":
      return { ...EMPTY_PAYLOAD, prediction_type: "winner", predicted_outcome: submission.outcome };
    case "correct_score":
      return {
        ...EMPTY_PAYLOAD,
        prediction_type: "correct_score",
        predicted_home_score: submission.homeScore,
        predicted_away_score: submission.awayScore,
      };
    case "first_scorer":
      return { ...EMPTY_PAYLOAD, prediction_type: "first_scorer", predicted_player_id: submission.playerId };
    case "total_goals":
      return { ...EMPTY_PAYLOAD, prediction_type: "total_goals", predicted_total_goals: submission.band };
    case "cards_corners":
      return {
        ...EMPTY_PAYLOAD,
        prediction_type: "cards_corners",
        predicted_cards: submission.cards,
        predicted_corners: submission.corners,
      };
    case "motm":
      return { ...EMPTY_PAYLOAD, prediction_type: "motm", predicted_player_id: submission.playerId };
  }
}

/** Scores are validated against the same range migration 0079's
 * `predictions_score_range` enforces, so a bad value is a readable message
 * here rather than a raw constraint violation. */
function scoreIsSane(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 20;
}

/**
 * No cron/live-polling job exists to flip `locked_at` at kickoff (see
 * FOOTBALL_LIVE_POLLING_ENABLED) — so kickoff-has-passed is enforced here,
 * against the fixture's real synced kickoff_at, rather than relying on a
 * column nothing populates yet. RLS's `locked_at is null` check still applies
 * underneath this as a second layer once that automation exists.
 *
 * The lock rule and the XP model are unchanged by the arrival of six types:
 * every type locks at the same kickoff, and every type is scored through the
 * same `points_awarded` column by the same admin pass.
 */
export async function submitPrediction(fixtureId: string, submission: PredictionSubmission) {
  const profile = await getOrCreateProfile();
  if (!profile) {
    return { error: "You must be signed in to predict." };
  }

  // Six types per fixture instead of one, so the same per-minute budget would
  // let a user fill in barely three matches. Raised proportionally, not
  // removed — it is still a real anti-spam bound.
  const rateLimit = await checkRateLimit(`user:${profile.id}`, "submit_prediction", 60, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  if (submission.type === "correct_score") {
    if (!scoreIsSane(submission.homeScore) || !scoreIsSane(submission.awayScore)) {
      return { error: "Enter a scoreline between 0 and 20 for each side." };
    }
  }

  const supabase = createServerSupabaseClient();
  const { data: fixture, error: fixtureError } = await supabase
    .from("fixtures")
    .select("kickoff_at, status, home_team_id, away_team_id")
    .eq("id", fixtureId)
    .maybeSingle();

  if (fixtureError || !fixture) {
    return { error: "That fixture no longer exists." };
  }
  if (fixture.status !== "scheduled" || new Date(fixture.kickoff_at) <= new Date()) {
    return { error: "Predictions lock at kickoff. This match has already started." };
  }

  // A named player must actually be at one of the two clubs in KIVO's own
  // squad data. Without this a client could name any player in the database —
  // and a first-scorer prediction for someone who is not in the match is not
  // a prediction, it is a row that can never be settled.
  if (submission.type === "first_scorer" || submission.type === "motm") {
    const { data: player } = await supabase
      .from("players")
      .select("id, current_team_id")
      .eq("id", submission.playerId)
      .maybeSingle();

    const squadIds = [fixture.home_team_id, fixture.away_team_id];
    if (!player || player.current_team_id === null || !squadIds.includes(player.current_team_id)) {
      return { error: "Pick a player from one of these two squads." };
    }
  }

  const { error } = await supabase.from("predictions").upsert(
    { profile_id: profile.id, fixture_id: fixtureId, ...rowPayload(submission) },
    { onConflict: "profile_id,fixture_id,prediction_type" },
  );

  if (error) {
    logError("predictions.submitPrediction", error);
    return { error: "Couldn't save your prediction. Try again." };
  }

  revalidatePath("/predictions");
  revalidatePath(`/matches/${fixtureId}`);
  return { error: null };
}

/**
 * Removes one of the caller's picks. Six types means changing your mind can
 * mean "actually, I don't want to call this one at all" — which used to be
 * unexpressible, because there was only ever one pick and picking again
 * replaced it.
 *
 * `predictions_delete_own_unlocked` (0001) is what actually enforces the
 * lock; this is the same belt-and-braces the submit path uses.
 */
export async function clearPrediction(fixtureId: string, type: PredictionType) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in to predict." };

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("predictions")
    .delete()
    .eq("profile_id", profile.id)
    .eq("fixture_id", fixtureId)
    .eq("prediction_type", type);

  if (error) {
    logError("predictions.clearPrediction", error);
    return { error: "Couldn't remove that prediction. Try again." };
  }

  revalidatePath("/predictions");
  revalidatePath(`/matches/${fixtureId}`);
  return { error: null };
}

export type PredictionCandidate = { id: string; name: string; teamId: string };

export type FixturePredictionState = {
  /** Real squad members of the two clubs, or an empty list when KIVO has not
   * synced either squad — in which case the player-naming types are offered
   * as genuinely unavailable rather than as an empty dropdown. */
  candidates: PredictionCandidate[];
  homeTeamId: string;
  awayTeamId: string;
  picks: PredictionPick[];
  error: string | null;
};

/**
 * Everything the expanded picker needs for one fixture, fetched on demand.
 *
 * Deliberately per-fixture and lazy: /predictions renders twenty cards, and
 * eagerly loading two squads for each of them would be ~800 player rows
 * fetched to render five collapsed panels nobody opened. The winner pills —
 * the fast path, and the only one most people use — need none of this and
 * still render server-side with the page.
 */
export async function loadFixturePredictionState(fixtureId: string): Promise<FixturePredictionState> {
  const empty: FixturePredictionState = {
    candidates: [],
    homeTeamId: "",
    awayTeamId: "",
    picks: [],
    error: null,
  };

  const profile = await getOrCreateProfile();
  const supabase = createServerSupabaseClient();

  const { data: fixture } = await supabase
    .from("fixtures")
    .select("home_team_id, away_team_id")
    .eq("id", fixtureId)
    .maybeSingle();

  if (!fixture) return { ...empty, error: "That fixture no longer exists." };

  const [{ data: players }, { data: predictions }] = await Promise.all([
    supabase
      .from("players")
      .select("id, full_name, known_as, current_team_id")
      .in("current_team_id", [fixture.home_team_id, fixture.away_team_id])
      .order("full_name", { ascending: true }),
    profile
      ? supabase
          .from("predictions")
          .select(PREDICTION_PICK_COLUMNS)
          .eq("profile_id", profile.id)
          .eq("fixture_id", fixtureId)
      : Promise.resolve({ data: [] }),
  ]);

  return {
    candidates: (players ?? [])
      .filter((player) => player.current_team_id !== null)
      .map((player) => ({
        id: player.id,
        name: player.known_as || player.full_name,
        teamId: player.current_team_id as string,
      })),
    homeTeamId: fixture.home_team_id,
    awayTeamId: fixture.away_team_id,
    picks: (predictions ?? []).map(pickFromRow),
    error: null,
  };
}
