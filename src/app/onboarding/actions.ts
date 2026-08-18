"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { awardBadge, awardXp, type AwardedBadge } from "@/lib/rewards";
import { resolveAvatarSrc } from "@/lib/kivo-assets";
import { isSupportedTimeZone } from "@/lib/timezone";

const ONBOARDING_COMPLETE_XP = 10;

export type OnboardingTeam = {
  name: string;
  short_name: string | null;
  crest_url: string | null;
};

/**
 * Everything the completion screen shows, and nothing it doesn't: each field
 * is read back from the row that was actually written (or from the award
 * calls' own real results), so the "Welcome to KIVO" moment can only ever
 * render facts the database agrees with. A field that isn't real comes back
 * null/0 and the UI omits that piece entirely rather than inventing a
 * plausible-looking stand-in.
 */
export type OnboardingCompletion = {
  /** Non-null when the profile write itself failed — the flow must stay put and retry, not congratulate. */
  error: string | null;
  /** 0 when the xp_ledger insert didn't land; never show XP the ledger has no record of. */
  xpAwarded: number;
  badge: AwardedBadge | null;
  /** The username as persisted, not as typed. */
  username: string;
  /** Null when they skipped the (optional) club step. */
  team: OnboardingTeam | null;
  avatarSrc: string | null;
};

const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;

/**
 * Debounced as-you-type availability check for the username step below —
 * lets the form tell a user their handle is taken before they hit Continue
 * instead of only finding out from saveUsernameStep's 23505 branch after a
 * full round trip. Uses the same `is_username_available` SECURITY DEFINER
 * RPC as Settings' checkUsernameAvailable (src/app/(app)/profile/actions.ts)
 * — profiles has no cross-user SELECT policy, so a plain client query can't
 * check whether another row's username is taken. Comparison is case-
 * insensitive (username is `citext`), matching saveUsernameStep. Returns
 * `available: null` for "can't tell yet" (bad format, not signed in, or the
 * check itself failed) so the UI can stay silent rather than show a false
 * positive/negative.
 */
export async function checkUsername(username: string): Promise<{ available: boolean | null }> {
  const trimmed = username.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(trimmed)) {
    return { available: null };
  }

  const profile = await getOrCreateProfile();
  if (!profile) {
    return { available: null };
  }

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.rpc("is_username_available", {
    p_username: trimmed,
    p_exclude_profile_id: profile.id,
  });

  if (error) {
    console.error("Failed to check username availability", error);
    return { available: null };
  }

  return { available: data };
}

/**
 * Step 1 of 2. Only saves the username — `onboarding_completed` isn't set
 * here so a user who reloads mid-flow lands back on onboarding rather than
 * /home with no favourite team ever asked. finishOnboarding() below is what
 * actually completes the flow, after the optional team step.
 */
export async function saveUsernameStep(formData: FormData): Promise<{ error: string | null }> {
  const username = String(formData.get("username") ?? "")
    .trim()
    .toLowerCase();

  if (!USERNAME_PATTERN.test(username)) {
    return { error: "Username must be 3-24 characters: lowercase letters, numbers and underscores only." };
  }

  const profile = await getOrCreateProfile();
  if (!profile) {
    return { error: "You must be signed in." };
  }

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.from("profiles").update({ username }).eq("id", profile.id);

  if (error) {
    if (error.code === "23505") {
      return { error: "That username is taken. Try another." };
    }
    console.error("Failed to save username", error);
    return { error: "Something went wrong. Try again." };
  }

  return { error: null };
}

/**
 * Step 2 of 2 (or the only step, when no teams are synced yet to offer a
 * picker for). `teamId` is optional by design — favourite_team_id is a
 * personalization anchor (src/lib/ai/grounding.ts), not a requirement.
 *
 * Deliberately does *not* redirect: it used to jump straight to /home the
 * instant XP/a badge were awarded, so the "Welcome to KIVO" moment never
 * actually rendered anywhere. Returning the real award instead lets the
 * client show a genuine completion screen (the actual badge, XP, handle and
 * club just earned/chosen) and navigate on to /home only once the user
 * confirms.
 *
 * The profile row is re-read via `.select()` on the update itself rather than
 * echoing back the arguments: what the completion screen shows then comes
 * from the row Postgres actually holds, so it can't drift from the truth
 * (e.g. a username normalized on write). A failed update returns `error` and
 * awards nothing — previously it logged and carried on, handing the user a
 * congratulations screen for a profile whose `onboarding_completed` was still
 * false, which would bounce them straight back here from /home.
 *
 * `deviceTimezone` (KN-89) is the browser's own
 * `Intl.DateTimeFormat().resolvedOptions().timeZone`, which the flow displays
 * to the user on the step before this fires — see the note inside on why it is
 * best-effort and can never fail a signup.
 */
export async function finishOnboarding(
  teamId: string | null,
  deviceTimezone: string | null = null,
): Promise<OnboardingCompletion> {
  const profile = await getOrCreateProfile();
  if (!profile) {
    redirect("/sign-in");
  }

  // KN-89. The browser proposes its own `Intl` zone and the flow shows the
  // user which zone that is before this runs, so storing it here is a
  // confirmation rather than an inference — the rule is that KIVO is *told* a
  // timezone, never that it works one out from an IP address.
  //
  // Validated, then dropped on the floor if it doesn't validate. A zone this
  // runtime does not recognise must not be the reason a signup cannot
  // complete: the column stays null, every consumer falls back to UTC and says
  // so, and Settings offers the same choice again later.
  const timezone = deviceTimezone !== null && isSupportedTimeZone(deviceTimezone) ? deviceTimezone : null;

  const supabase = createServerSupabaseClient();
  const { data: updated, error } = await supabase
    .from("profiles")
    .update({
      favourite_team_id: teamId,
      onboarding_completed: true,
      // Never overwrite a zone the user has already stated with a device
      // reading — the stated one is the more deliberate signal of the two.
      ...(timezone !== null && profile.timezone === null ? { timezone } : {}),
    })
    .eq("id", profile.id)
    .select("username, favourite_team_id, avatar_type, avatar_kivo_id, avatar_uploaded_url, avatar_url")
    .single();

  if (error || !updated) {
    console.error("Failed to finish onboarding", error);
    return {
      error: "We couldn't save that. Check your connection and try again.",
      xpAwarded: 0,
      badge: null,
      username: profile.username,
      team: null,
      avatarSrc: null,
    };
  }

  // The rewards run on the service-role client (xp_ledger/user_badges have no
  // client-facing write policy), which throws outright rather than returning an
  // error if SUPABASE_SERVICE_ROLE_KEY is missing from the environment. By this
  // point `onboarding_completed` is already true, so letting that propagate
  // would strand the user on the club step retrying a step that has in fact
  // succeeded. Degrade instead: the welcome screen renders without the reward
  // pieces, which is honest — nothing was written, so nothing is claimed.
  let xpWritten = false;
  let badge: AwardedBadge | null = null;
  try {
    [xpWritten, badge] = await Promise.all([
      awardXp(profile.id, ONBOARDING_COMPLETE_XP, "Completed onboarding"),
      awardBadge(profile.id, "welcome"),
    ]);
  } catch (rewardError) {
    console.error("Failed to award onboarding rewards", rewardError);
  }

  // Read the club back by the id the row actually ended up with, so a team
  // that vanished between the picker rendering and this write shows as "no
  // club picked" rather than as a name the profile isn't really pointing at.
  let team: OnboardingTeam | null = null;
  if (updated.favourite_team_id) {
    const { data } = await supabase
      .from("teams")
      .select("name, short_name, crest_url")
      .eq("id", updated.favourite_team_id)
      .maybeSingle();
    team = data ?? null;
  }

  return {
    error: null,
    xpAwarded: xpWritten ? ONBOARDING_COMPLETE_XP : 0,
    badge,
    username: updated.username,
    team,
    avatarSrc: resolveAvatarSrc(updated),
  };
}

/**
 * Bypasses the flow entirely (no username change, no favourite team) — so,
 * unlike finishOnboarding, this deliberately awards nothing: the "welcome"
 * badge reads "Completed onboarding and picked a KIVO handle", which skip
 * does neither of.
 */
export async function skipOnboarding() {
  const profile = await getOrCreateProfile();
  if (!profile) return;

  const supabase = createServerSupabaseClient();
  await supabase.from("profiles").update({ onboarding_completed: true }).eq("id", profile.id);
  redirect("/home");
}
