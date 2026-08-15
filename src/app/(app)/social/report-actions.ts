"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import type { Database } from "@/lib/supabase/types";

type ModerationTargetType = Database["public"]["Enums"]["moderation_target_type"];

// Matches the `reports_reason_length` check constraint in
// supabase/migrations/0001_kivo_core_schema.sql (char_length between 1 and 1000).
const MAX_REASON_LENGTH = 1000;

/**
 * Writes a row to `reports` under the `reports_insert_own` RLS policy
 * (reporter_profile_id = auth caller's own profile). This is the one missing
 * piece the admin moderation queue, urgency badges and audit trail have been
 * waiting on since nothing in the app ever wrote to this table before.
 */
export async function reportContent(targetType: ModerationTargetType, targetId: string, reason: string) {
  const trimmedReason = reason.trim();
  if (!trimmedReason || trimmedReason.length > MAX_REASON_LENGTH) {
    return { error: "Choose a reason before submitting." };
  }

  const profile = await getOrCreateProfile();
  if (!profile) {
    return { error: "You must be signed in to report content." };
  }

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.from("reports").insert({
    reporter_profile_id: profile.id,
    target_type: targetType,
    target_id: targetId,
    reason: trimmedReason,
    status: "pending",
  });

  if (error) {
    console.error("Failed to submit report", error);
    return { error: "Couldn't submit your report. Try again." };
  }

  revalidatePath("/admin/moderation");
  return { error: null };
}
