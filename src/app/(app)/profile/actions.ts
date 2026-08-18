"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { COUNTRY_CODES } from "@/lib/countries";
import { escapeLikePattern } from "@/lib/text";
import { TEAM_PICKER_LIMIT, type PickerTeam } from "@/lib/profile-picker";
import { logError } from "@/lib/log";

const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;


/**
 * Debounced as-you-type availability check backing UsernameEditor's inline
 * indicator — lets a user find out their new handle is taken before they
 * submit, instead of only from updateUsername's 23505 branch below after a
 * round trip. Same `is_username_available` SECURITY DEFINER RPC as
 * onboarding's checkUsername (src/app/onboarding/actions.ts): profiles has
 * no cross-user SELECT policy, so this can't be a plain client query.
 * p_exclude_profile_id is the caller's own id so re-typing their current
 * username correctly reports "available" rather than "taken by you".
 */
export async function checkUsernameAvailable(username: string): Promise<{ available: boolean | null }> {
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
    logError("profile.checkUsernameAvailability", error);
    return { available: null };
  }

  return { available: data };
}

export async function updateUsername(formData: FormData) {
  const username = String(formData.get("username") ?? "")
    .trim()
    .toLowerCase();

  if (!USERNAME_PATTERN.test(username)) {
    return { error: "Username must be 3-24 characters: lowercase letters, numbers and underscores only." };
  }

  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in." };

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.from("profiles").update({ username }).eq("id", profile.id);

  if (error) {
    if (error.code === "23505") return { error: "That username is taken. Try another." };
    logError("profile.updateUsername", error);
    return { error: "Something went wrong. Try again." };
  }

  revalidatePath("/profile");
  return { error: null };
}

// Matches the `profiles_display_name_length` check constraint added in
// supabase/migrations/0065_profile_backgrounds_and_display_name.sql, and the
// `profiles_bio_length` one from 0001 — same "duplicated literal, kept in sync
// by hand" precedent as MAX_BIO_LENGTH in src/app/(app)/settings/actions.ts,
// which holds the other copy of the bio cap.
const MAX_DISPLAY_NAME_LENGTH = 40;
const MAX_BIO_LENGTH = 500;

/** The three surfaces that render a profile's identity. Named once so a new
 * field cannot be added that updates two of them and quietly not the third —
 * which is how a stale display name in Settings would go unnoticed. */
function revalidateProfileSurfaces(username: string) {
  revalidatePath("/profile");
  revalidatePath("/profile/edit");
  revalidatePath("/settings");
  revalidatePath(`/u/${username}`);
}

/**
 * Display name. Had no writer anywhere in the product before the profile
 * rebuild, which is why every Supabase-Auth-era account rendered as its
 * generated `user_xxxxxxxxxx` handle and nothing else: `resolveViewerProfile`
 * deliberately inserts null rather than deriving a name from the email
 * local-part, and nothing since ever set it.
 *
 * Empty means null, never `''`: `profiles_display_name_length` (migration
 * 0065) rejects an empty string outright, and a row holding one would render
 * as a blank heading that the "fall back to @username" path never catches.
 *
 * One field per action, rather than one action writing name + bio + country
 * together, because each of these now has its own page. A combined write from
 * a single-field form would blank the two fields that form never showed.
 */
export async function updateDisplayName(displayName: string) {
  const value = displayName.trim();
  if (value.length > MAX_DISPLAY_NAME_LENGTH) {
    return { error: `Name must be ${MAX_DISPLAY_NAME_LENGTH} characters or fewer.` };
  }

  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in." };

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("profiles")
    .update({ display_name: value.length > 0 ? value : null })
    .eq("id", profile.id);

  if (error) {
    logError("profile.updateDisplayName", error);
    return { error: "Something went wrong. Try again." };
  }

  revalidateProfileSurfaces(profile.username);
  return { error: null };
}

/**
 * Bio. The column and its 500-character constraint have existed since
 * migration 0001 and Settings has been able to write it for a while, but the
 * founder's report was that there was nowhere on the profile itself to write
 * one — which was true, and is what `/profile/edit/bio` now is. Settings'
 * `updateProfileDetails` still writes the same column; both revalidate the
 * same surfaces, so whichever a user reaches first, the other agrees.
 */
export async function updateBio(bio: string) {
  const value = bio.trim();
  if (value.length > MAX_BIO_LENGTH) {
    return { error: `Bio must be ${MAX_BIO_LENGTH} characters or fewer.` };
  }

  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in." };

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("profiles")
    .update({ bio: value.length > 0 ? value : null })
    .eq("id", profile.id);

  if (error) {
    logError("profile.updateBio", error);
    return { error: "Something went wrong. Try again." };
  }

  revalidateProfileSurfaces(profile.username);
  return { error: null };
}

/** Country, as an ISO 3166-1 alpha-2 code from `COUNTRY_CODES`, or null for
 * "prefer not to say" — which is a real answer, not a failure to answer. */
export async function updateCountry(country: string | null) {
  const value = (country ?? "").trim().toUpperCase();
  const next = value.length > 0 ? value : null;

  if (next !== null && !COUNTRY_CODES.includes(next as (typeof COUNTRY_CODES)[number])) {
    return { error: "Choose a valid country." };
  }

  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in." };

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.from("profiles").update({ country: next }).eq("id", profile.id);

  if (error) {
    logError("profile.updateCountry", error);
    return { error: "Something went wrong. Try again." };
  }

  revalidateProfileSurfaces(profile.username);
  return { error: null };
}

/**
 * Sets — or clears — the one club this profile supports.
 *
 * "Exactly one" is not enforced by this function; it is enforced by the schema.
 * `profiles.favourite_team_id` is a single nullable uuid FK (migration 0001),
 * so a second club is not something a user can express and not something this
 * action has to reject. The alternative shape — a `follows` row with
 * `followed_type = 'team'` — is deliberately NOT what this writes: following a
 * club is a subscription and there can be many, supporting one is an identity
 * and there is one. `src/lib/football/match-notifications.ts` already treats
 * the two as different audiences.
 *
 * The id is checked against `teams` before it is written even though the FK
 * would reject a bogus one anyway, so a stale picker (a club deleted between
 * render and submit) produces a sentence a person can act on instead of a
 * foreign-key violation surfaced as "something went wrong".
 */
export async function updateFavouriteTeam(teamId: string | null) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in." };

  const supabase = createServerSupabaseClient();

  if (teamId !== null) {
    const { data: team, error: lookupError } = await supabase
      .from("teams")
      .select("id")
      .eq("id", teamId)
      .maybeSingle();
    if (lookupError) {
      logError("profile.verifyClubSaving", lookupError);
      return { error: "Something went wrong. Try again." };
    }
    if (!team) return { error: "That club isn't in KIVO any more. Pick another." };
  }

  const { error } = await supabase.from("profiles").update({ favourite_team_id: teamId }).eq("id", profile.id);

  if (error) {
    logError("profile.updateFavouriteTeam", error);
    return { error: "Something went wrong. Try again." };
  }

  revalidateProfileSurfaces(profile.username);
  // The club also personalises /home's own fixture selection
  // (src/app/(app)/home/page.tsx reads favourite_team_id directly).
  revalidatePath("/home");
  return { error: null };
}

/**
 * Club search for the "change the club you support" picker.
 *
 * Server-side rather than filtering a preloaded list in the browser: `teams`
 * is the one table in this schema that grows without bound as competitions are
 * synced, and shipping all of it to a phone to filter three characters against
 * would be the wrong shape the moment real data lands. `escapeLikePattern`
 * keeps a `%` or `_` typed by a user from turning into a wildcard — the same
 * treatment /players and /fantasy already give their own searches.
 *
 * Returns the alphabetical head of the table for an empty query, so the picker
 * has something real to show before anyone types. Today that is an empty list,
 * because the live project has zero teams synced; the page says so plainly
 * rather than rendering an empty box.
 */
export async function searchTeams(query: string): Promise<{ teams: PickerTeam[] }> {
  const profile = await getOrCreateProfile();
  if (!profile) return { teams: [] };

  const trimmed = query.trim();
  const supabase = createServerSupabaseClient();
  let request = supabase
    .from("teams")
    .select("id, name, short_name, crest_url, country")
    .order("name", { ascending: true })
    .limit(TEAM_PICKER_LIMIT);

  if (trimmed) request = request.ilike("name", `%${escapeLikePattern(trimmed)}%`);

  const { data, error } = await request;
  if (error) {
    logError("profile.searchTeams", error);
    return { teams: [] };
  }
  return { teams: data ?? [] };
}
