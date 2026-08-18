"use server";

import { logError } from "@/lib/log";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { canViewModerationData } from "@/lib/admin";

type Decision = "actioned" | "dismissed";

export async function resolveReport(reportId: string, decision: Decision, note: string) {
  const profile = await getOrCreateProfile();
  if (!profile || !canViewModerationData(profile.role)) {
    return { error: "You don't have moderation access." };
  }

  const supabase = createServerSupabaseClient();
  const { data: report, error: fetchError } = await supabase
    .from("reports")
    .select("id, target_type, target_id, status")
    .eq("id", reportId)
    .maybeSingle();

  if (fetchError || !report) {
    return { error: "That report no longer exists." };
  }
  if (report.status === "actioned" || report.status === "dismissed") {
    return { error: "That report was already resolved." };
  }

  const { error: updateError } = await supabase
    .from("reports")
    .update({ status: decision, resolved_by_profile_id: profile.id, resolved_at: new Date().toISOString() })
    .eq("id", reportId);

  if (updateError) {
    logError("admin.moderation.resolveReport", updateError);
    return { error: "Couldn't update the report. Try again." };
  }

  const { error: auditError } = await supabase.from("moderation_actions").insert({
    admin_profile_id: profile.id,
    action: decision,
    target_type: report.target_type,
    target_id: report.target_id,
    reason: note.trim() || null,
    report_id: report.id,
  });

  if (auditError) logError("admin.moderation.writeAuditRow", auditError);

  revalidatePath("/admin/moderation");
  return { error: null };
}
