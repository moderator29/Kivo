import "server-only";
import { createServiceRoleSupabaseClient } from "./supabase/server";
import type { Json } from "./supabase/types";

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
  const supabase = createServiceRoleSupabaseClient();
  const { error } = await supabase
    .from("audit_log")
    .insert({ actor_profile_id: actorProfileId, action, target_type: targetType, metadata });
  if (error) console.error(`Failed to write audit log entry (${action})`, error);
}
