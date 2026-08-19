"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { checkRateLimit } from "@/lib/rate-limit";
import { logError } from "@/lib/log";
import { readClubs } from "@/lib/football/club-directory";

export type ClubOption = { id: string; name: string; shortName: string | null; crestUrl: string | null; country: string | null };

const CLUB_RESULTS_LIMIT = 12;

/**
 * Teams to choose from in /settings/clubs.
 *
 * Now the same `readClubs` the profile picker and onboarding use
 * (src/lib/football/club-directory.ts), so the three surfaces cannot disagree
 * about which clubs exist or in what order they come. This one had the better
 * answer first — most-followed clubs ahead of the alphabet, via
 * `get_most_followed_teams` — but it only applied to the empty query and only
 * here; `search_clubs_ranked` (migration 0108) does the same thing for a typed
 * search too, in SQL, and does not need a second round trip to hydrate the
 * ids.
 *
 * If nothing is synced yet the list is genuinely empty and the picker says so;
 * it never falls back to a hardcoded list of famous clubs.
 */
export async function searchClubs(query: string): Promise<{ error: string | null; clubs: ClubOption[] }> {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "Sign in to choose a club.", clubs: [] };

  const trimmed = query.trim().slice(0, 60);
  const rateLimit = await checkRateLimit(`user:${profile.id}`, "search_clubs", 40, 60);
  if (!rateLimit.ok) return { error: rateLimit.error, clubs: [] };

  const supabase = createServerSupabaseClient();
  const page = await readClubs(supabase, { query: trimmed, limit: CLUB_RESULTS_LIMIT });

  // "Could not look" and "nothing matched" are different facts and this picker
  // has always distinguished them — `readClubs` reports the first as `failed`
  // rather than as an empty list.
  if (page.failed) return { error: "Couldn't search clubs. Try again.", clubs: [] };

  return { error: null, clubs: page.clubs.map(toClubOption) };
}

function toClubOption(team: {
  id: string;
  name: string;
  short_name: string | null;
  crest_url: string | null;
  country: string | null;
}): ClubOption {
  return { id: team.id, name: team.name, shortName: team.short_name, crestUrl: team.crest_url, country: team.country };
}

/**
 * Sets, changes or clears the viewer's rival club.
 *
 * Only the rival: the club you *support* is edited at /profile/club, which a
 * sibling built as part of the profile rebuild, and two editors writing
 * `favourite_team_id` from two pages is how a product ends up with two answers
 * to one question. /settings/clubs shows the supported club and links there.
 *
 * "One rival" is enforced by the schema rather than by this action remembering
 * to — `rival_team_id` is a single nullable FK, so a second rival is not
 * something to refuse, it is not expressible. The only thing checked here is
 * the same-club case, which does have a real constraint behind it
 * (profiles_rival_is_not_favourite, migration 0068) but would surface as an
 * opaque Postgres error rather than a sentence.
 */
export async function setRivalClub(teamId: string | null): Promise<{ error: string | null }> {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "Sign in to choose a club." };

  const rateLimit = await checkRateLimit(`user:${profile.id}`, "set_rival_club", 20, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  if (teamId && profile.favourite_team_id === teamId) {
    return { error: "That's the club you support. Pick a different rival." };
  }

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.from("profiles").update({ rival_team_id: teamId }).eq("id", profile.id);

  if (error) {
    logError("setRivalClub.failed", error);
    return { error: "Couldn't save that. Try again." };
  }

  // /social's Rivals filter is derived entirely from this column.
  revalidatePath("/settings/clubs");
  revalidatePath("/social");
  return { error: null };
}
