import "server-only";
import { createServiceRoleSupabaseClient } from "./supabase/server";
import { logError } from "./log";

/**
 * xp_ledger/user_badges have no client-facing write policy by design — these
 * are trust-sensitive ledgers, only ever written by server-side logic via the
 * service-role client. This is that logic's single entry point.
 *
 * Returns whether the ledger row was actually written. Every pre-existing
 * caller awaits this purely for its side effect and ignores the result (so
 * this is additive, not a breaking change), but a caller that wants to
 * *display* the XP it just awarded — onboarding's completion screen — needs
 * to know: showing "+10 XP" after a failed insert would be telling the user
 * they earned something the ledger has no record of.
 */
export async function awardXp(profileId: string, amount: number, reason: string): Promise<boolean> {
  // Callers await this for its side effect *after* their real work has
  // already committed (a post is inserted, then XP is awarded), so a failure
  // here must degrade to `false`, never throw — including
  // createServiceRoleSupabaseClient()'s synchronous "supabaseKey is
  // required." when the env var is missing, which would otherwise turn a
  // successful post into a failed Server Action.
  try {
    const supabase = createServiceRoleSupabaseClient();
    const { error } = await supabase.from("xp_ledger").insert({ profile_id: profileId, amount, reason });
    if (error) {
      logError("rewards.awardXp", error, { profileId, amount, reason });
      return false;
    }
    return true;
  } catch (error) {
    logError("rewards.awardXp", error, { profileId, amount, reason });
    return false;
  }
}

export type AwardedBadge = { name: string; description: string | null; icon_url: string | null };

/**
 * Returns the real badge row (name/description/icon_url straight from
 * `badges`) on success — or on a 23505 "already has it" conflict, since the
 * badge is genuinely theirs either way — so a caller that wants to *display*
 * what was just earned (e.g. onboarding's completion screen) has real data
 * to show instead of needing a second round trip. Every other existing
 * caller just `await`s this for its side effect and ignores the return
 * value, so this is additive, not a breaking change.
 */
export async function awardBadge(profileId: string, badgeCode: string): Promise<AwardedBadge | null> {
  // Same best-effort contract as awardXp above — see the note there on why
  // the client construction has to be inside the try.
  try {
    const supabase = createServiceRoleSupabaseClient();
    const { data: badge } = await supabase
      .from("badges")
      .select("id, name, description, icon_url")
      .eq("code", badgeCode)
      .maybeSingle();
    if (!badge) return null;

    const { error } = await supabase.from("user_badges").insert({ profile_id: profileId, badge_id: badge.id });
    // 23505 = already has this badge — expected on repeat triggers (e.g. every
    // post after the first calling the "first post" award path), not an error.
    if (error && error.code !== "23505") {
      logError("rewards.awardBadge", error, { profileId, badgeCode });
      return null;
    }

    return { name: badge.name, description: badge.description, icon_url: badge.icon_url };
  } catch (error) {
    logError("rewards.awardBadge", error, { profileId, badgeCode });
    return null;
  }
}

/**
 * Whether this profile already holds a badge.
 *
 * Exists for KIVO_NEXT_GEN KN-19, which is worth explaining because the code
 * it replaces looked entirely reasonable. `createPost`/`createPoll` decided
 * whether to award the `ten_posts` badge by running a full
 * `count: "exact"` over the author's entire `posts` history on **every single
 * submission** — an O(total posts) aggregate to answer a question whose answer
 * can never change again once it is yes, for a badge write that is already
 * idempotent. A prolific user pays more for it every time they post, forever.
 *
 * Two indexed lookups now: this, and (only while the badge is still unheld) a
 * `.limit(10)` fetch of post ids. Note the count could not simply be capped —
 * PostgREST's `count=exact` runs its own aggregate over the whole filtered set
 * and ignores `limit`, so `.limit(10)` would have bounded the rows returned
 * and not the work done. Fetching ten ids and checking the length is what
 * actually bounds it.
 *
 * Best-effort like every other function in this file: a failure returns false,
 * which at worst means the caller does the work it would have done anyway.
 */
export async function hasBadge(profileId: string, badgeCode: string): Promise<boolean> {
  try {
    const supabase = createServiceRoleSupabaseClient();
    const { data, error } = await supabase
      .from("user_badges")
      .select("badge_id, badges!inner(code)")
      .eq("profile_id", profileId)
      .eq("badges.code", badgeCode)
      .maybeSingle();
    if (error) {
      logError("rewards.hasBadge", error, { profileId, badgeCode });
      return false;
    }
    return data !== null;
  } catch (error) {
    logError("rewards.hasBadge", error, { profileId, badgeCode });
    return false;
  }
}
