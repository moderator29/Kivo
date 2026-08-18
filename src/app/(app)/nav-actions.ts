"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";

export type ViewerNavStats = {
  /** Everything this profile follows — clubs, players, competitions and
   * people. Deliberately the same set `/profile/following` lists, because the
   * number in the drawer links straight to that page and a count that
   * disagreed with the list under it would just look broken. */
  following: number;
  /** People who follow this profile. */
  followers: number;
};

/**
 * The two real numbers in the nav drawer's identity block.
 *
 * Fetched when the drawer is first opened rather than on every page render:
 * the drawer is closed the overwhelming majority of the time, and two queries
 * per navigation to populate a panel nobody opened is the kind of cost that
 * never shows up in a screenshot and always shows up in a bill.
 *
 * Both sides are genuinely counted, never estimated. "Who follows me" has no
 * covering SELECT policy on `follows` (follows_select_own only covers the
 * follower side), so it goes through `get_my_followers()` — the narrow,
 * zero-argument SECURITY DEFINER read migration 0048 added for exactly this,
 * which can only ever answer for the caller. Returns null for a guest, so the
 * drawer renders no stats row at all rather than two zeros.
 */
export async function getViewerNavStats(): Promise<ViewerNavStats | null> {
  const profile = await getOrCreateProfile();
  if (!profile) return null;

  const supabase = createServerSupabaseClient();
  const [{ count }, { data: followers }] = await Promise.all([
    supabase
      .from("follows")
      .select("followed_id", { count: "exact", head: true })
      .eq("follower_profile_id", profile.id),
    supabase.rpc("get_my_followers"),
  ]);

  return { following: count ?? 0, followers: followers?.length ?? 0 };
}
