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

export async function awardBadge(profileId: string, badgeCode: string) {
  const supabase = createServiceRoleSupabaseClient();
  const { data: badge } = await supabase.from("badges").select("id").eq("code", badgeCode).maybeSingle();
  if (!badge) return;

  const { error } = await supabase.from("user_badges").insert({ profile_id: profileId, badge_id: badge.id });
  // 23505 = already has this badge — expected on repeat triggers (e.g. every
  // post after the first calling the "first post" award path), not an error.
  if (error && error.code !== "23505") console.error(`Failed to award badge ${badgeCode}`, error);
}
