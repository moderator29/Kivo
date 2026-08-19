"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { awardBadge, awardXp, type AwardedBadge } from "@/lib/rewards";
import { resolveAvatarSrc } from "@/lib/kivo-assets";
import { isSupportedTimeZone } from "@/lib/timezone";
// The one definition of what a KIVO handle is, shared with /sign-up's form and
// its Server Action. This file used to keep its own copy of the same regex and
// its own inline `.trim().toLowerCase()`; two copies of a validation rule is
// how the rule drifts.
import { USERNAME_PATTERN, normalizeUsername } from "@/lib/auth-shared";
import { logError } from "@/lib/log";
import { readClubs } from "@/lib/football/club-directory";
import { TEAM_PICKER_LIMIT, type PickerTeam } from "@/lib/profile-picker";

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
/**
 * The club search behind onboarding's two club steps.
 *
 * Onboarding used to render `select … from teams order by name limit 60` as a
 * fixed grid with no search at all — so on the live database a first-time user
 * was offered sixty reserve and youth sides, and if their club was not among
 * them there was no way to ask for it. That is the first screen of the
 * product, and it was the screen most likely to convince somebody KIVO does
 * not know about their football.
 *
 * Same `readClubs` as /profile/club and /settings/clubs, so all three now
 * agree on which clubs and in what order. See src/lib/football/club-directory.ts
 * for the ordering and why it is the only honest one available.
 */
export async function searchOnboardingClubs(query: string): Promise<{ teams: PickerTeam[] }> {
  const profile = await getOrCreateProfile();
  if (!profile) return { teams: [] };

  const supabase = createServerSupabaseClient();
  const page = await readClubs(supabase, { query, limit: TEAM_PICKER_LIMIT });
  return { teams: page.clubs };
}

export async function checkUsername(username: string): Promise<{ available: boolean | null }> {
  const trimmed = normalizeUsername(username);
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
    logError("onboarding.checkUsernameAvailability", error);
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
  const username = normalizeUsername(String(formData.get("username") ?? ""));

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
    logError("onboarding.saveUsername", error);
    return { error: "Something went wrong. Try again." };
  }

  return { error: null };
}

/**
 * KN-40: the four alert categories, as three choices instead of eight
 * switches.
 *
 * Onboarding is the one guaranteed moment of a user's attention this product
 * gets, and until now it spent that moment on two questions. Every other
 * personalisation signal KIVO holds — follows, these preferences, activity
 * privacy, theme — was discoverable only by someone who went looking in
 * Settings.
 *
 * Deliberately only the four *category* columns. `email_enabled` and
 * `push_enabled` are left at their table defaults and are not offered here,
 * because KIVO has neither transactional email nor push infrastructure yet
 * (see ENVIRONMENT.md): asking somebody to choose email alerts during signup
 * would be selling a delivery channel that does not exist. `marketing_emails_enabled`
 * is untouched for the same reason plus a consent one — an opt-in buried in a
 * signup flow is not consent.
 *
 * Skipping writes nothing at all, which leaves the table's own defaults in
 * place; it is not a fourth preset.
 */
export const ALERT_PRESETS = {
  everything: {
    match_alerts_enabled: true,
    social_alerts_enabled: true,
    prediction_alerts_enabled: true,
    fantasy_alerts_enabled: true,
  },
  football_only: {
    match_alerts_enabled: true,
    social_alerts_enabled: false,
    prediction_alerts_enabled: true,
    fantasy_alerts_enabled: true,
  },
  matches_only: {
    match_alerts_enabled: true,
    social_alerts_enabled: false,
    prediction_alerts_enabled: false,
    fantasy_alerts_enabled: false,
  },
} as const;

export type AlertPreset = keyof typeof ALERT_PRESETS;

function isAlertPreset(value: string | null): value is AlertPreset {
  return value !== null && Object.prototype.hasOwnProperty.call(ALERT_PRESETS, value);
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
  /** KN-40: clubs the user chose to follow on the optional step. The favourite
   * club is added to this set server-side — picking a club as your favourite
   * and then not following it is a distinction nobody intends. */
  followTeamIds: string[] = [],
  /** KN-40: which alert preset they picked, or null for "skipped", which
   * writes nothing and leaves the table defaults alone. */
  alertPreset: string | null = null,
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
    logError("onboarding.finish", error);
    return {
      error: "We couldn't save that. Check your connection and try again.",
      xpAwarded: 0,
      badge: null,
      username: profile.username,
      team: null,
      avatarSrc: null,
    };
  }

  // KN-40: the two optional steps, written after the profile update has
  // already succeeded and deliberately best-effort. Neither can fail a signup:
  // a user who has just completed onboarding must never be bounced back into it
  // because a *preference* insert failed. Both are re-offerable — the follows
  // from any club page, the alerts from Settings — so the cost of a silent miss
  // is small and the cost of a hard failure here is somebody stuck outside the
  // product.
  const clubsToFollow = [...new Set([...(teamId ? [teamId] : []), ...followTeamIds])].filter(
    (id) => typeof id === "string" && id.length > 0,
  );

  if (clubsToFollow.length > 0) {
    // `follows` has a unique constraint per (follower, type, id) — ignoring
    // duplicates makes a double-submitted final step a no-op rather than an
    // error, the same shape the fantasy carry-forward upserts use.
    const { error: followError } = await supabase.from("follows").upsert(
      clubsToFollow.map((followedId) => ({
        follower_profile_id: profile.id,
        followed_type: "team" as const,
        followed_id: followedId,
      })),
      { onConflict: "follower_profile_id,followed_type,followed_id", ignoreDuplicates: true },
    );
    if (followError) logError("onboarding.followClubs", followError);
  }

  if (isAlertPreset(alertPreset)) {
    const { error: preferenceError } = await supabase
      .from("notification_preferences")
      .upsert({ profile_id: profile.id, ...ALERT_PRESETS[alertPreset] }, { onConflict: "profile_id" });
    if (preferenceError) logError("onboarding.alertPreset", preferenceError);
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
      // KN-91: onboarding completes once per profile, so the profile id *is*
      // the award's identity. A double-submitted final step now returns the
      // existing award instead of writing a second one.
      awardXp(profile.id, ONBOARDING_COMPLETE_XP, "Completed onboarding", `onboarding:${profile.id}`),
      awardBadge(profile.id, "welcome"),
    ]);
  } catch (rewardError) {
    logError("onboarding.awardRewards", rewardError);
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
