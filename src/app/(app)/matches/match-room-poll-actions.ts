"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { checkRateLimit } from "@/lib/rate-limit";
import { awardBadge } from "@/lib/rewards";
import { awardSocialPostXp } from "@/lib/xp-policy";
import { logError } from "@/lib/log";
import {
  REFEREE_DECISION_OPTIONS,
  refereeDecisionQuestion,
  type RefereeDecision,
} from "@/lib/match-room-polls";

/**
 * The two poll types the founding brief names by name — man of the match, and
 * referee decisions — as real, templated, identifiable polls rather than a
 * freeform question with a helpful placeholder.
 *
 * The distinction is not cosmetic. A chip that pre-fills a text box produces
 * a poll that KIVO cannot tell apart from any other poll five seconds later,
 * so nothing downstream can read it: not the Room, not the prediction scoring
 * pass, not a future "what did the room think" summary. Migration 0078's
 * `posts.poll_kind` and `poll_options.player_id` are what make a Room's MOTM
 * vote a thing the rest of the product can actually use — and they are why a
 * man-of-the-match *prediction* can now be settled at all (see
 * src/lib/predictions.ts).
 *
 * Both actions write through `create_templated_poll` (SECURITY INVOKER), so
 * the post and its options land in one transaction. `createPoll`'s
 * insert-then-insert path compensates with a delete if the second insert
 * fails, which is an apology rather than a guarantee; a 22-option MOTM poll
 * is exactly the case where a half-written poll is most likely and most
 * damaging.
 */

const MOTM_QUESTION = "Man of the match?";

/**
 * Seeds a man-of-the-match poll from the fixture's REAL synced lineup.
 *
 * A sibling's template deliberately left the options blank, on the reasoning
 * that KIVO offering a shortlist would be picking candidates on the voter's
 * behalf. That reasoning is right about a shortlist and wrong about a lineup:
 * the starting XI is not KIVO's opinion of who is worth voting for, it is the
 * list of people who actually played, which is precisely the honest answer
 * set. So this seeds from `lineups` when the lineup is really there, and
 * refuses — out loud — when it is not, rather than offering an empty poll or
 * inventing names.
 *
 * Starters only. A full matchday squad including benches would be forty-odd
 * options, most of them people who never came on, and the bench is not a
 * shortlist judgement — it is a fact about who started.
 */
export async function createMotmPoll(fixtureId: string) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in to start a poll." };

  const rateLimit = await checkRateLimit(`user:${profile.id}`, "create_post", 5, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  const supabase = createServerSupabaseClient();

  // One MOTM poll per fixture is a partial unique index in migration 0078, so
  // this check is a readable message rather than the guard itself.
  const { data: existing } = await supabase
    .from("posts")
    .select("id")
    .eq("fixture_id", fixtureId)
    .eq("poll_kind", "motm")
    .maybeSingle();

  if (existing) {
    return { error: "This match already has a man-of-the-match vote. Scroll up to find it." };
  }

  const { data: lineupRows, error: lineupError } = await supabase
    .from("lineups")
    .select("player_id, is_starting, shirt_number, player:players(id, full_name, known_as)")
    .eq("fixture_id", fixtureId)
    .eq("is_starting", true)
    .order("shirt_number", { ascending: true });

  if (lineupError) {
    logError("matches.match-room-poll-actions.loadLineupForMotm", lineupError);
    return { error: "Couldn't read this match's lineup. Try again." };
  }

  const starters = (lineupRows ?? []).filter((row) => row.player !== null);

  if (starters.length < 2) {
    return {
      error:
        // No "synced". A fan reading this needs to know when they can do the
        // thing, not which of KIVO's jobs has not run — see the frontend
        // sweep's own note in RECOMMENDATIONS.md.
        "The line-ups for this match aren't out yet, so there's no list of players to vote on. Line-ups are usually published about an hour before kick-off.",
    };
  }

  // Migration 0078 caps a poll at 30 options; two starting XIs is 22, and a
  // provider occasionally reports more. Truncating silently would drop real
  // players off a real ballot, so this refuses instead.
  if (starters.length > 30) {
    return { error: "This match's lineup is larger than a poll can hold. Ask the room in your own words instead." };
  }

  const labels = starters.map((row) => row.player!.known_as || row.player!.full_name);
  const playerIds = starters.map((row) => row.player!.id);

  const { data: postId, error } = await supabase.rpc("create_templated_poll", {
    p_fixture_id: fixtureId,
    p_poll_kind: "motm",
    p_question: MOTM_QUESTION,
    p_labels: labels,
    p_player_ids: playerIds,
  });

  if (error || !postId) {
    logError("matches.match-room-poll-actions.createMotmPoll", error);
    return { error: "Couldn't start the vote. Try again." };
  }

  // Through the shared XP policy, not a bespoke award: a templated poll is a
  // post, so it earns the same 2 XP against the same daily allowance and the
  // same `post:<id>` identity as every other piece of community content. This
  // award used to bypass that allowance entirely.
  await Promise.all([awardSocialPostXp(profile.id, postId), awardBadge(profile.id, "first_post")]);

  revalidatePath(`/matches/${fixtureId}`);
  revalidatePath("/social");
  return { error: null };
}

/**
 * A referee-decision poll, as a structured question rather than free text.
 *
 * Structured means two things. The decision itself comes from a fixed list —
 * penalty, red card, offside, disallowed goal, VAR — so a room's referee
 * polls are comparable to each other rather than twenty phrasings of the same
 * argument. And the answers are always the same three, because "was that the
 * right call" genuinely has three answers and one of them is "I'm not sure",
 * which a two-option poll silently forces into a side.
 *
 * The minute is optional and free-form-numeric, because a match can contain
 * two penalty shouts and the room needs to say which one. It is the voter's
 * own claim about when, never KIVO's.
 */
export async function createRefereePoll(fixtureId: string, decision: RefereeDecision, minute: number | null) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in to start a poll." };

  if (!REFEREE_DECISION_OPTIONS.some((option) => option.id === decision)) {
    return { error: "Pick one of the decisions listed." };
  }
  if (minute !== null && (!Number.isInteger(minute) || minute < 0 || minute > 130)) {
    return { error: "Enter a minute between 0 and 130, or leave it blank." };
  }

  const rateLimit = await checkRateLimit(`user:${profile.id}`, "create_post", 5, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  const supabase = createServerSupabaseClient();
  const { data: postId, error } = await supabase.rpc("create_templated_poll", {
    p_fixture_id: fixtureId,
    p_poll_kind: "referee_decision",
    p_question: refereeDecisionQuestion(decision, minute),
    p_labels: REFEREE_VERDICTS.map((verdict) => verdict.label),
    // No option here stands for a player, so every id is null. The array must
    // still be the same length as the labels — see create_templated_poll.
    p_player_ids: REFEREE_VERDICTS.map(() => null) as unknown as string[],
  });

  if (error || !postId) {
    logError("matches.match-room-poll-actions.createRefereePoll", error);
    return { error: "Couldn't start the poll. Try again." };
  }

  // Keyed on the real post, not on the question the user typed. The previous
  // key — `ref-poll:<fixture>:<decision>:<minute>` — was built from the
  // caller's own inputs, so one fixture offered 5 decisions x 131 minute
  // values = 655 distinct "already awarded?" keys, each worth another 2 XP,
  // bounded only by the 5-per-minute posting limit. See src/lib/xp-policy.ts.
  await Promise.all([awardSocialPostXp(profile.id, postId), awardBadge(profile.id, "first_post")]);

  revalidatePath(`/matches/${fixtureId}`);
  revalidatePath("/social");
  return { error: null };
}

/** The three answers, in the order they are offered. Deliberately not
 * yes/no: a referee poll with no "not sure" pushes every undecided viewer
 * into a verdict they do not hold, which produces a number that reads like
 * consensus and is not one. */
const REFEREE_VERDICTS = [
  { id: "right", label: "Right call" },
  { id: "wrong", label: "Wrong call" },
  { id: "unsure", label: "Not sure" },
] as const;
