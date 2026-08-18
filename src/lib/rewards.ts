import "server-only";
import { createServiceRoleSupabaseClient } from "./supabase/server";
import { logError } from "./log";

/**
 * xp_ledger/user_badges have no client-facing write policy by design — these
 * are trust-sensitive ledgers, only ever written by server-side logic via the
 * service-role client. This is that logic's single entry point.
 *
 * Returns whether this profile now genuinely holds the XP. Every pre-existing
 * caller awaits this purely for its side effect and ignores the result (so
 * this is additive, not a breaking change), but a caller that wants to
 * *display* the XP it just awarded — onboarding's completion screen — needs
 * to know: showing "+10 XP" after a failed insert would be telling the user
 * they earned something the ledger has no record of.
 *
 * `sourceKey` (KIVO_NEXT_GEN KN-91, migration 0061) is what makes an award
 * idempotent. Before it, nothing stopped the same award landing twice, and
 * every path here can be retried — a user double-submitting, the framework
 * re-running a Server Action, an admin re-running the prediction scoring
 * pass. Double-credited XP is not cosmetic: it is the leaderboard being wrong
 * for everybody.
 *
 * Pass a key that identifies the real-world action, not the attempt:
 * `prediction:<id>`, `post:<id>`, `onboarding:<profile id>`. Omit it only when
 * the award genuinely can recur with no stable identity — a null key means
 * "deliberately not deduplicated", and the column's comment says so, rather
 * than a placeholder key implying an identity the data does not have.
 *
 * A 23505 on the key returns **true**, not false. The row already exists, so
 * the user really does hold this XP — reporting failure would make onboarding
 * hide a reward the ledger is holding. This is the same rule `awardBadge`
 * below already applies to a duplicate badge, for the same reason.
 */
export async function awardXp(
  profileId: string,
  amount: number,
  reason: string,
  sourceKey?: string,
): Promise<boolean> {
  // Callers await this for its side effect *after* their real work has
  // already committed (a post is inserted, then XP is awarded), so a failure
  // here must degrade to `false`, never throw — including
  // createServiceRoleSupabaseClient()'s synchronous "supabaseKey is
  // required." when the env var is missing, which would otherwise turn a
  // successful post into a failed Server Action.
  try {
    const supabase = createServiceRoleSupabaseClient();
    const { error } = await supabase
      .from("xp_ledger")
      .insert({ profile_id: profileId, amount, reason, ...(sourceKey ? { source_key: sourceKey } : {}) });
    if (error) {
      // 23505 = this exact award is already on the ledger. Expected on any
      // retry, and the whole point of the key — see the doc comment above.
      if (error.code === "23505") return true;
      logError("rewards.awardXp", error, { profileId, amount, reason, sourceKey });
      return false;
    }
    return true;
  } catch (error) {
    logError("rewards.awardXp", error, { profileId, amount, reason, sourceKey });
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

/**
 * Awards every criteria-driven badge this profile now qualifies for (KN-92).
 *
 * Before this, a badge's condition lived in application code — so every one of
 * the concrete new badges RECOMMENDATIONS item 260 lists meant editing three
 * files and shipping. `badges.criteria` (migration 0073) makes a badge whose
 * condition is "count a known kind of row and compare to a threshold" pure
 * content: adding one is an INSERT.
 *
 * The ceiling is deliberate and worth knowing: `criteria` names a *fact key*
 * from a fixed whitelist inside the database, not a table and a filter. A
 * genuinely new kind of fact still needs a line of SQL. That trade is the
 * whole reason this is safe — `criteria` is admin-writable content, and a
 * jsonb field that could name any table would be a SQL-injection surface with
 * an admin-shaped key.
 *
 * Best-effort, like every other reward path here: this runs after the user's
 * real work has already committed, so a failure degrades to a logged warning
 * rather than turning a successful post into a failed Server Action.
 */
export async function evaluateBadgeCriteria(profileId: string): Promise<number> {
  try {
    const supabase = createServiceRoleSupabaseClient();
    const { data, error } = await supabase.rpc("evaluate_badge_criteria", { p_profile_id: profileId });
    if (error) {
      logError("rewards.evaluateBadgeCriteria", error, { profileId });
      return 0;
    }
    return data ?? 0;
  } catch (error) {
    logError("rewards.evaluateBadgeCriteria", error, { profileId });
    return 0;
  }
}
