import "server-only";
import { createServiceRoleSupabaseClient } from "./supabase/server";

/**
 * xp_ledger/user_badges have no client-facing write policy by design — these
 * are trust-sensitive ledgers, only ever written by server-side logic via the
 * service-role client. This is that logic's single entry point.
 */
export async function awardXp(profileId: string, amount: number, reason: string) {
  const supabase = createServiceRoleSupabaseClient();
  const { error } = await supabase.from("xp_ledger").insert({ profile_id: profileId, amount, reason });
  if (error) console.error(`Failed to award ${amount}XP (${reason})`, error);
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
    console.error(`Failed to award badge ${badgeCode}`, error);
    return null;
  }

  return { name: badge.name, description: badge.description, icon_url: badge.icon_url };
}
