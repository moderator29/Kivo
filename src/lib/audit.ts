import "server-only";
import { createServiceRoleSupabaseClient } from "./supabase/server";
import type { Json } from "./supabase/types";
import { logError } from "./log";

/**
 * audit_log is the general-purpose sensitive-action trail (distinct from
 * moderation_actions, which is content-moderation-specific and already
 * written by src/app/admin/moderation/actions.ts). Nothing wrote to it
 * anywhere in this codebase before this. Uses the service-role client
 * deliberately: audit_log_insert_admin's RLS requires private.is_admin(),
 * which only recognizes the 'admin'/'super_admin' roles, not the narrower
 * 'football_data_admin' role that's allowed to trigger the actions this is
 * called from (see canManageFootballData) — a plain client would fail to
 * log a football_data_admin's own action. Best-effort like awardXp/
 * awardBadge: a logging failure must never block the real action.
 *
 * ## `targetId` and `reason`
 *
 * Both columns have existed since migration 0001, along with
 * `idx_audit_log_target on (target_type, target_id)`, and until /admin/audit was
 * built nothing wrote either one: every caller put the identifying id inside
 * `metadata` instead, under a different key each time (`anomaly_id`,
 * `reportId`, `request_id`, `targetProfileId`). That is fine for a trail nobody
 * reads and useless for one somebody does — "every action taken against this
 * account" is an index scan on `target_id` and a full-table jsonb rummage on
 * metadata. So `targetId` is now an explicit argument, passed by every caller
 * that HAS a single uuid subject, and deliberately left null by the ones that
 * do not (a prune spanning thousands of sync runs has no one target, and
 * inventing one would be worse than leaving the column honest).
 *
 * `reason` is the operator's own note where one was typed. It stays out of
 * `metadata` for the same reason: it is a first-class column, and a reader
 * should not have to know which key a given action chose.
 */
export async function logAudit(
  actorProfileId: string,
  action: string,
  targetType: string,
  metadata: Record<string, Json> = {},
  /** The single uuid this action was taken against, when there is exactly one.
   *  Omit rather than guess — see above. */
  options: { targetId?: string | null; reason?: string | null } = {},
) {
  // "Best-effort" has to include the client construction: it throws
  // synchronously ("supabaseKey is required.") when SUPABASE_SERVICE_ROLE_KEY
  // is missing, which would let an audit-log failure block the very action it
  // exists only to record.
  try {
    const supabase = createServiceRoleSupabaseClient();
    const { error } = await supabase
      .from("audit_log")
      .insert({
        actor_profile_id: actorProfileId,
        action,
        target_type: targetType,
        target_id: options.targetId ?? null,
        reason: options.reason ?? null,
        metadata,
      });
    if (error) logError("audit.logAudit", error, { action, targetType, actorProfileId });
  } catch (error) {
    logError("audit.logAudit", error, { action, targetType, actorProfileId });
  }
}
