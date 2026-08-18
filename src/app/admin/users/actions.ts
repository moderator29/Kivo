"use server";

import { revalidatePath } from "next/cache";
import { getOrCreateProfile, type Profile } from "@/lib/profile";
import { canViewUserData } from "@/lib/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

/**
 * RECOMMENDATIONS.md item 234: real admin ban/suspend/role-change actions on
 * /admin/users, replacing the "read-only by design" placeholder that used to
 * live there. Every write below goes through the plain (non-service-role)
 * server client deliberately, same as src/app/admin/moderation/actions.ts:
 * profiles_update_own_or_admin's admin branch (supabase/migrations/0045_moderation_status.sql)
 * already grants a caller with private.is_admin() (role admin/super_admin —
 * exactly what canViewUserData checks below) full write access, so there's
 * no need to bypass RLS with the service-role client here. RLS is the real
 * backstop either way: even if this file had a bug, profiles_update_own_or_admin
 * still requires is_admin() for anyone who isn't updating their own row.
 */

type ActionResult = { error: string | null };

// Matches profiles_moderation_reason_length in 0045_moderation_status.sql.
const REASON_MAX_LENGTH = 500;

/**
 * Shared guard for every action below: real admin-tier access (mirrors the
 * RLS admin branch exactly, see canViewUserData's own doc comment), plus a
 * "can't target your own account" rule that has no RLS equivalent (the
 * self-tamper lock in 0045 only stops a *non-admin* target from clearing
 * their own restriction — an admin acting on themselves would otherwise
 * sail straight through the admin branch and could suspend/ban their own
 * only-admin account with no way back in). Not a substitute for RLS, a
 * friendlier failure than the raw Postgres error a stray self-target would
 * otherwise surface, same reasoning as triggerFootballSync's own early
 * checks in admin/data-health/actions.ts.
 */
async function requireModerationActor(targetProfileId: string): Promise<{ profile: Profile } | { error: string }> {
  const profile = await getOrCreateProfile();
  if (!profile || !canViewUserData(profile.role)) {
    return { error: "You don't have user admin access." };
  }
  if (profile.id === targetProfileId) {
    return { error: "You can't apply a moderation action to your own account." };
  }
  return { profile };
}

function requireReason(raw: string): { reason: string } | { error: string } {
  const reason = raw.trim();
  if (!reason) return { error: "A reason is required." };
  if (reason.length > REASON_MAX_LENGTH) return { error: `Reason must be ${REASON_MAX_LENGTH} characters or fewer.` };
  return { reason };
}

const SUSPEND_DURATIONS_DAYS = [1, 3, 7, 30] as const;
export type SuspendDurationDays = (typeof SUSPEND_DURATIONS_DAYS)[number];

/** Suspend: time-boxed. moderation_expires_at drives the lazy auto-revert
 * (private.effective_moderation_status in 0045) -- nothing here or anywhere
 * else in this codebase sweeps it on a timer. */
export async function suspendUser(targetProfileId: string, durationDays: SuspendDurationDays, reasonRaw: string): Promise<ActionResult> {
  const actor = await requireModerationActor(targetProfileId);
  if ("error" in actor) return actor;
  if (!SUSPEND_DURATIONS_DAYS.includes(durationDays)) {
    return { error: "Invalid suspension duration." };
  }
  const reasonResult = requireReason(reasonRaw);
  if ("error" in reasonResult) return reasonResult;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();
  const supabase = createServerSupabaseClient();
  const { data: target, error } = await supabase
    .from("profiles")
    .update({
      moderation_status: "suspended",
      moderation_reason: reasonResult.reason,
      moderation_expires_at: expiresAt,
      moderation_set_by: actor.profile.id,
      moderation_set_at: now.toISOString(),
    })
    .eq("id", targetProfileId)
    .select("username")
    .maybeSingle();

  if (error || !target) {
    console.error("Failed to suspend user", error);
    return { error: "Couldn't suspend that user. Try again." };
  }

  await logAudit(actor.profile.id, "suspend_user", "profile", {
    targetProfileId,
    targetUsername: target.username,
    reason: reasonResult.reason,
    durationDays,
    expiresAt,
  });

  revalidatePath("/admin/users");
  return { error: null };
}

/** Ban: permanent soft-lock. Never a hard delete (see profiles_delete_admin
 * in 0001, which this deliberately doesn't call) -- moderation history and
 * any content other users replied to both stay intact. */
export async function banUser(targetProfileId: string, reasonRaw: string): Promise<ActionResult> {
  const actor = await requireModerationActor(targetProfileId);
  if ("error" in actor) return actor;
  const reasonResult = requireReason(reasonRaw);
  if ("error" in reasonResult) return reasonResult;

  const supabase = createServerSupabaseClient();
  const { data: target, error } = await supabase
    .from("profiles")
    .update({
      moderation_status: "banned",
      moderation_reason: reasonResult.reason,
      moderation_expires_at: null,
      moderation_set_by: actor.profile.id,
      moderation_set_at: new Date().toISOString(),
    })
    .eq("id", targetProfileId)
    .select("username")
    .maybeSingle();

  if (error || !target) {
    console.error("Failed to ban user", error);
    return { error: "Couldn't ban that user. Try again." };
  }

  await logAudit(actor.profile.id, "ban_user", "profile", {
    targetProfileId,
    targetUsername: target.username,
    reason: reasonResult.reason,
  });

  revalidatePath("/admin/users");
  return { error: null };
}

/** Shadow-mute: zero friction to the user themselves -- no reason field, by
 * design (see RECOMMENDATIONS.md item 234's spec: this is a quiet content
 * filter, not a sanction the user is ever shown). */
export async function shadowMuteUser(targetProfileId: string): Promise<ActionResult> {
  const actor = await requireModerationActor(targetProfileId);
  if ("error" in actor) return actor;

  const supabase = createServerSupabaseClient();
  const { data: target, error } = await supabase
    .from("profiles")
    .update({
      moderation_status: "shadow_muted",
      moderation_reason: null,
      moderation_expires_at: null,
      moderation_set_by: actor.profile.id,
      moderation_set_at: new Date().toISOString(),
    })
    .eq("id", targetProfileId)
    .select("username")
    .maybeSingle();

  if (error || !target) {
    console.error("Failed to shadow-mute user", error);
    return { error: "Couldn't shadow-mute that user. Try again." };
  }

  await logAudit(actor.profile.id, "shadow_mute_user", "profile", {
    targetProfileId,
    targetUsername: target.username,
  });

  revalidatePath("/admin/users");
  return { error: null };
}

/** Clears any restriction back to `active` early. Used by both the
 * "Un-mute" action (shadow_muted -> active) and "Reinstate" action
 * (suspended/banned -> active) in the UI below -- same effect, one action,
 * same as how a real platform's "restore account" does one thing regardless
 * of which restriction it's lifting. */
export async function reinstateUser(targetProfileId: string): Promise<ActionResult> {
  const actor = await requireModerationActor(targetProfileId);
  if ("error" in actor) return actor;

  const supabase = createServerSupabaseClient();
  const { data: target, error } = await supabase
    .from("profiles")
    .update({
      moderation_status: "active",
      moderation_reason: null,
      moderation_expires_at: null,
      moderation_set_by: actor.profile.id,
      moderation_set_at: new Date().toISOString(),
    })
    .eq("id", targetProfileId)
    .select("username")
    .maybeSingle();

  if (error || !target) {
    console.error("Failed to reinstate user", error);
    return { error: "Couldn't reinstate that user. Try again." };
  }

  await logAudit(actor.profile.id, "reinstate_user", "profile", {
    targetProfileId,
    targetUsername: target.username,
  });

  revalidatePath("/admin/users");
  return { error: null };
}
