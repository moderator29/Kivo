"use server";

import { revalidatePath } from "next/cache";
import { getOrCreateProfile, type Profile } from "@/lib/profile";
import { canViewUserData } from "@/lib/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { logError } from "@/lib/log";
import type { ModerationStatus } from "@/lib/moderation";

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
 *
 * THREE PROPERTIES EVERY ACTION IN THIS FILE NOW HOLDS, and each one closes a
 * way a moderator could act on a wrong belief.
 *
 * **It cannot be applied to a state the moderator did not see.** Each action
 * takes the status the admin's screen was actually showing and updates only a
 * row still in that state. Without it, "Suspend" offered on a row that was
 * loaded as active but has since been banned by a colleague would silently
 * *downgrade* a permanent ban to a three-day suspension, and report success.
 * The moderator would have no way to know they had just released someone.
 * That is also what stops a double-click from re-issuing anything: the second
 * request no longer matches.
 *
 * **It records who and why, in both ledgers.** `audit_log` and
 * `moderation_actions` had drifted into holding half the story each — account
 * sanctions in one, report decisions in the other. Every write here now lands
 * in both, so either table answers "what has this admin done" on its own.
 *
 * **Reversals are recorded too.** Un-muting and reinstating used to take no
 * reason at all, which meant the single most consequential act in the tool —
 * releasing an account somebody else restricted — was the one act with no
 * recorded justification. They now require an internal note. It is written to
 * the audit trail only, never to `profiles.moderation_reason`, so the
 * user-facing behaviour of a shadow-mute (a quiet content filter, never shown
 * to the user) is unchanged.
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
 * checks in admin/football/actions.ts.
 */
async function requireModerationActor(targetProfileId: string): Promise<{ profile: Profile } | { error: string }> {
  const profile = await getOrCreateProfile();
  if (!profile || !canViewUserData(profile.role)) {
    return { error: "You don't have user admin access." };
  }
  if (profile.id === targetProfileId) {
    return { error: "You can't apply a moderation action to your own account." };
  }

  // A bound on a privileged path rather than spam control — see the same
  // reasoning in resolveReport. No real admin session issues thirty account
  // sanctions in a minute.
  const rateLimit = await checkRateLimit(`user:${profile.id}`, "moderate_user", 30, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  return { profile };
}

function requireReason(raw: string, label = "A reason"): { reason: string } | { error: string } {
  const reason = raw.trim();
  if (!reason) return { error: `${label} is required.` };
  if (reason.length > REASON_MAX_LENGTH) return { error: `${label} must be ${REASON_MAX_LENGTH} characters or fewer.` };
  return { reason };
}

const MODERATION_STATUSES: ModerationStatus[] = ["active", "shadow_muted", "suspended", "banned"];

function isModerationStatus(value: unknown): value is ModerationStatus {
  return typeof value === "string" && (MODERATION_STATUSES as string[]).includes(value);
}

const STATUS_LABEL: Record<ModerationStatus, string> = {
  active: "active",
  shadow_muted: "shadow-muted",
  suspended: "suspended",
  banned: "banned",
};

type StatusChange = {
  moderation_status: ModerationStatus;
  /** User-facing. Null for the statuses KIVO deliberately never explains to
   * the user (shadow-mute) or that have nothing left to explain (active). */
  moderation_reason: string | null;
  moderation_expires_at: string | null;
};

/**
 * The one write path all four actions share: a compare-and-swap onto
 * `profiles`, followed by both audit rows.
 *
 * `expectedStatus` is the *effective* status the admin's screen rendered (see
 * effectiveModerationStatus), not the raw column — a suspension whose
 * expiry has passed displays as active while the stored value still says
 * suspended, and matching on the raw column alone would reject an action the
 * admin was right to take. The `.or()` below is exactly that one case.
 */
async function applyStatusChange(opts: {
  actorProfileId: string;
  targetProfileId: string;
  expectedStatus: ModerationStatus;
  change: StatusChange;
  auditAction: string;
  /** Recorded in both ledgers. Never written to profiles.moderation_reason
   * unless `change.moderation_reason` says so independently. */
  note: string;
  metadata?: Record<string, string | number | null>;
  failureMessage: string;
}): Promise<ActionResult> {
  const supabase = createServerSupabaseClient();

  let query = supabase
    .from("profiles")
    .update({
      ...opts.change,
      moderation_set_by: opts.actorProfileId,
      moderation_set_at: new Date().toISOString(),
    })
    .eq("id", opts.targetProfileId);

  if (opts.expectedStatus === "active") {
    // Stored 'active', or a suspension that has already lapsed — which the
    // admin's screen correctly showed as active.
    query = query.or(
      `moderation_status.eq.active,and(moderation_status.eq.suspended,moderation_expires_at.lt.${new Date().toISOString()})`,
    );
  } else {
    query = query.eq("moderation_status", opts.expectedStatus);
  }

  const { data: target, error } = await query.select("username").maybeSingle();

  if (error) {
    logError(`admin.users.${opts.auditAction}`, error);
    return { error: opts.failureMessage };
  }

  if (!target) {
    // Either the account is gone, or its status is no longer what the admin
    // was looking at. The second is the dangerous one, so it is named.
    const { data: current } = await supabase
      .from("profiles")
      .select("moderation_status")
      .eq("id", opts.targetProfileId)
      .maybeSingle();

    if (!current) return { error: "That account no longer exists." };
    return {
      error: `This account is now ${STATUS_LABEL[current.moderation_status]}, not ${STATUS_LABEL[opts.expectedStatus]}. Reload before acting so you don't undo someone else's decision.`,
    };
  }

  const metadata = {
    targetProfileId: opts.targetProfileId,
    targetUsername: target.username,
    previousStatus: opts.expectedStatus,
    newStatus: opts.change.moderation_status,
    note: opts.note,
    ...(opts.metadata ?? {}),
  };

  // moderation_actions is the content-moderation ledger and its target_type
  // enum has always included 'profile'; account sanctions simply never wrote
  // to it. Best-effort, like logAudit: a ledger failure must not roll back a
  // sanction that has already been applied, but it is logged rather than
  // swallowed.
  const { error: ledgerError } = await supabase.from("moderation_actions").insert({
    admin_profile_id: opts.actorProfileId,
    action: opts.auditAction,
    target_type: "profile",
    target_id: opts.targetProfileId,
    reason: opts.note,
    report_id: null,
  });
  if (ledgerError) logError(`admin.users.${opts.auditAction}.ledger`, ledgerError);

  // targetId is the account the sanction landed on, so "every action ever taken
  // against this account" is one indexed lookup on /admin/audit rather than a
  // jsonb search. `note` is the operator's own words and belongs in `reason`.
  await logAudit(opts.actorProfileId, opts.auditAction, "profile", metadata, {
    targetId: opts.targetProfileId,
    reason: opts.note ?? null,
  });

  revalidatePath("/admin/users");
  return { error: null };
}

const SUSPEND_DURATIONS_DAYS = [1, 3, 7, 30] as const;
export type SuspendDurationDays = (typeof SUSPEND_DURATIONS_DAYS)[number];

/** Suspend: time-boxed. moderation_expires_at drives the lazy auto-revert
 * (private.effective_moderation_status in 0045) -- nothing here or anywhere
 * else in this codebase sweeps it on a timer. */
export async function suspendUser(
  targetProfileId: string,
  durationDays: SuspendDurationDays,
  reasonRaw: string,
  expectedStatus: ModerationStatus,
): Promise<ActionResult> {
  const actor = await requireModerationActor(targetProfileId);
  if ("error" in actor) return actor;
  if (!SUSPEND_DURATIONS_DAYS.includes(durationDays)) {
    return { error: "Invalid suspension duration." };
  }
  if (!isModerationStatus(expectedStatus)) {
    return { error: "Reload the page before acting on this account." };
  }
  const reasonResult = requireReason(reasonRaw);
  if ("error" in reasonResult) return reasonResult;

  const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

  return applyStatusChange({
    actorProfileId: actor.profile.id,
    targetProfileId,
    expectedStatus,
    change: {
      moderation_status: "suspended",
      moderation_reason: reasonResult.reason,
      moderation_expires_at: expiresAt,
    },
    auditAction: "suspend_user",
    note: reasonResult.reason,
    metadata: { durationDays, expiresAt },
    failureMessage: "Couldn't suspend that user. Try again.",
  });
}

/** Ban: permanent soft-lock. Never a hard delete (see profiles_delete_admin
 * in 0001, which this deliberately doesn't call) -- moderation history and
 * any content other users replied to both stay intact. */
export async function banUser(
  targetProfileId: string,
  reasonRaw: string,
  expectedStatus: ModerationStatus,
): Promise<ActionResult> {
  const actor = await requireModerationActor(targetProfileId);
  if ("error" in actor) return actor;
  if (!isModerationStatus(expectedStatus)) {
    return { error: "Reload the page before acting on this account." };
  }
  const reasonResult = requireReason(reasonRaw);
  if ("error" in reasonResult) return reasonResult;

  return applyStatusChange({
    actorProfileId: actor.profile.id,
    targetProfileId,
    expectedStatus,
    change: {
      moderation_status: "banned",
      moderation_reason: reasonResult.reason,
      moderation_expires_at: null,
    },
    auditAction: "ban_user",
    note: reasonResult.reason,
    failureMessage: "Couldn't ban that user. Try again.",
  });
}

/** Shadow-mute: zero friction to the user themselves -- no user-facing reason,
 * by design (see RECOMMENDATIONS.md item 234's spec: this is a quiet content
 * filter, not a sanction the user is ever shown). The internal note below is
 * a different thing entirely: it goes to the audit trail, which the user
 * never sees, and exists so the ledger can answer why. */
export async function shadowMuteUser(
  targetProfileId: string,
  noteRaw: string,
  expectedStatus: ModerationStatus,
): Promise<ActionResult> {
  const actor = await requireModerationActor(targetProfileId);
  if ("error" in actor) return actor;
  if (!isModerationStatus(expectedStatus)) {
    return { error: "Reload the page before acting on this account." };
  }
  const noteResult = requireReason(noteRaw, "An internal note");
  if ("error" in noteResult) return noteResult;

  return applyStatusChange({
    actorProfileId: actor.profile.id,
    targetProfileId,
    expectedStatus,
    change: {
      moderation_status: "shadow_muted",
      // Deliberately null: profiles.moderation_reason is user-facing, and a
      // shadow-mute the user can read the reason for is not a shadow-mute.
      moderation_reason: null,
      moderation_expires_at: null,
    },
    auditAction: "shadow_mute_user",
    note: noteResult.reason,
    failureMessage: "Couldn't shadow-mute that user. Try again.",
  });
}

/** Clears any restriction back to `active` early. Used by both the
 * "Un-mute" action (shadow_muted -> active) and "Reinstate" action
 * (suspended/banned -> active) in the UI below -- same effect, one action,
 * same as how a real platform's "restore account" does one thing regardless
 * of which restriction it's lifting.
 *
 * Requires a note. Reversing somebody else's sanction is the act most worth
 * being able to explain later, and it was the one act here that recorded no
 * explanation at all. */
export async function reinstateUser(
  targetProfileId: string,
  noteRaw: string,
  expectedStatus: ModerationStatus,
): Promise<ActionResult> {
  const actor = await requireModerationActor(targetProfileId);
  if ("error" in actor) return actor;
  if (!isModerationStatus(expectedStatus)) {
    return { error: "Reload the page before acting on this account." };
  }
  const noteResult = requireReason(noteRaw, "An internal note");
  if ("error" in noteResult) return noteResult;

  return applyStatusChange({
    actorProfileId: actor.profile.id,
    targetProfileId,
    expectedStatus,
    change: {
      moderation_status: "active",
      moderation_reason: null,
      moderation_expires_at: null,
    },
    auditAction: "reinstate_user",
    note: noteResult.reason,
    failureMessage: "Couldn't reinstate that user. Try again.",
  });
}
