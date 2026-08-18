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
 */
export async function logAudit(
  actorProfileId: string,
  action: string,
  targetType: string,
  metadata: Record<string, Json> = {},
) {
  // "Best-effort" has to include the client construction: it throws
  // synchronously ("supabaseKey is required.") when SUPABASE_SERVICE_ROLE_KEY
  // is missing, which would let an audit-log failure block the very action it
  // exists only to record.
  try {
    const supabase = createServiceRoleSupabaseClient();
    const { error } = await supabase
      .from("audit_log")
      .insert({ actor_profile_id: actorProfileId, action, target_type: targetType, metadata });
    if (error) logError("audit.logAudit", error, { action, targetType, actorProfileId });
  } catch (error) {
    logError("audit.logAudit", error, { action, targetType, actorProfileId });
  }
}
