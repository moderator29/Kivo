"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { checkRateLimit } from "@/lib/rate-limit";
import { generateInviteCode } from "@/app/(app)/fantasy/fantasy-rules";
import { logError } from "@/lib/log";

/**
 * Prediction leagues (KN-104) — the fantasy league mechanic, against
 * predictions people are already making.
 *
 * Everything about the join path is deliberately the same shape as
 * `joinFantasyLeague`, including the parts that look like duplication: the
 * fixed message set, the both-channels error read, and the app-layer rate
 * limit on top of the database's own. That is not copy-paste inertia — each
 * one exists because of a specific bug the fantasy version already paid for,
 * and diverging here would mean rediscovering them.
 */

const LEAGUE_NAME_MIN = 2;
const LEAGUE_NAME_MAX = 60;
const LEAGUE_MEMBERS_MIN = 2;
const LEAGUE_MEMBERS_MAX = 500;

/**
 * The exact, fixed set of user-safe messages `redeem_prediction_invite_code`
 * raises or returns by design. Anything else — a constraint violation, a type
 * error, any unexpected failure — is an internal detail that must never reach
 * a client as-is (RECOMMENDATIONS item 41).
 */
const KNOWN_REDEEM_ERRORS = new Set([
  "You must be signed in to join a league.",
  "You are doing that a bit too fast. Please wait a moment and try again.",
  "Invalid invite code. Check the code and try again.",
  "This league is full.",
]);

export async function createPredictionLeague(input: { name: string; maxMembers: number }) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in to create a league.", leagueId: null };

  const name = input.name.trim();
  if (name.length < LEAGUE_NAME_MIN || name.length > LEAGUE_NAME_MAX) {
    return { error: `League name must be between ${LEAGUE_NAME_MIN} and ${LEAGUE_NAME_MAX} characters.`, leagueId: null };
  }
  if (!Number.isInteger(input.maxMembers) || input.maxMembers < LEAGUE_MEMBERS_MIN || input.maxMembers > LEAGUE_MEMBERS_MAX) {
    return { error: `League size must be between ${LEAGUE_MEMBERS_MIN} and ${LEAGUE_MEMBERS_MAX} members.`, leagueId: null };
  }

  const allowance = await checkRateLimit(`user:${profile.id}`, "create_prediction_league", 5, 60 * 60);
  if (!allowance.ok) return { error: allowance.error, leagueId: null };

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("prediction_leagues")
    .insert({
      name,
      creator_profile_id: profile.id,
      invite_code: generateInviteCode(),
      max_members: input.maxMembers,
    })
    .select("id")
    .single();

  if (error || !data) {
    logError("predictions.createLeague", error, { profileId: profile.id });
    return { error: "Couldn't create that league. Try again.", leagueId: null };
  }

  // The creator joins their own league explicitly rather than the table doing
  // it implicitly. Creating and competing are different acts, and a trigger
  // that silently enrolled the creator would make "leave this league" behave
  // differently for them than for everybody else.
  const { error: joinError } = await supabase
    .from("prediction_league_members")
    .insert({ league_id: data.id, profile_id: profile.id });
  if (joinError) logError("predictions.createLeague.selfJoin", joinError, { leagueId: data.id });

  revalidatePath("/predictions");
  return { error: null, leagueId: data.id };
}

export async function joinPredictionLeague(inviteCode: string) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in to join a league.", leagueId: null };

  const code = inviteCode.trim().toUpperCase();
  if (code.length === 0) return { error: "Enter an invite code.", leagueId: null };

  // An app-layer limit on top of the database's own. Both are needed: this one
  // catches the ordinary case cheaply, and the RPC's catches a client calling
  // /rest/v1/rpc directly, which this action cannot see at all.
  const allowance = await checkRateLimit(`user:${profile.id}`, "join_prediction_league", 10, 60);
  if (!allowance.ok) return { error: allowance.error, leagueId: null };

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.rpc("redeem_prediction_invite_code", { p_invite_code: code });

  // Two error channels by design, and both must be read. Outcomes before the
  // throttle row is written raise; outcomes after it return a row with
  // `error_message` set, because raising would roll the throttle row back —
  // the exact bug migration 0024 exists to fix for fantasy.
  const rawMessage = error?.message ?? data?.[0]?.error_message ?? null;
  if (rawMessage) {
    if (!error) {
      // A returned error is an expected outcome, not a fault — no log noise.
    } else {
      logError("predictions.joinLeague", error, { profileId: profile.id });
    }
    return {
      error: KNOWN_REDEEM_ERRORS.has(rawMessage) ? rawMessage : "Couldn't join that league. Try again.",
      leagueId: null,
    };
  }

  const leagueId = data?.[0]?.id ?? null;
  revalidatePath("/predictions");
  return { error: null, leagueId };
}

export async function leavePredictionLeague(leagueId: string) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in." };

  const supabase = createServerSupabaseClient();
  // Scoped to the caller's own membership by the policy, not by this filter —
  // `prediction_league_members_delete_own` is the real boundary and the filter
  // just makes the intent readable.
  const { error } = await supabase
    .from("prediction_league_members")
    .delete()
    .eq("league_id", leagueId)
    .eq("profile_id", profile.id);

  if (error) {
    logError("predictions.leaveLeague", error, { profileId: profile.id, leagueId });
    return { error: "Couldn't leave that league. Try again." };
  }

  revalidatePath("/predictions");
  return { error: null };
}
