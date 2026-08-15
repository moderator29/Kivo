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
 * Captures the real target row's content at report-creation time, for
 * `reports.content_snapshot` (see supabase/migrations/0022_report_content_snapshot.sql,
 * RECOMMENDATIONS.md items 45/46). This is the only place the snapshot is
 * ever written: it survives a moderator's later hard delete of the target
 * (audit evidence) and gives the moderation queue something real to preview
 * even for content that's already gone by the time it's reviewed.
 *
 * Returns null (never a placeholder) when the target can't be read, e.g. it
 * was deleted between the reporter loading the page and submitting the report.
 */
async function captureContentSnapshot(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  targetType: ModerationTargetType,
  targetId: string,
) {
  if (targetType === "post") {
    const { data } = await supabase
      .from("posts")
      .select("body, created_at, fixture_id, author:profiles!posts_author_profile_id_fkey(username, display_name)")
      .eq("id", targetId)
      .maybeSingle();
    if (!data) return null;
    return {
      type: "post" as const,
      body: data.body,
      created_at: data.created_at,
      fixture_id: data.fixture_id,
      author_username: data.author?.username ?? null,
      author_display_name: data.author?.display_name ?? null,
    };
  }

  if (targetType === "comment") {
    const { data } = await supabase
      .from("comments")
      .select("body, created_at, post_id, author:profiles!comments_author_profile_id_fkey(username, display_name)")
      .eq("id", targetId)
      .maybeSingle();
    if (!data) return null;
    return {
      type: "comment" as const,
      body: data.body,
      created_at: data.created_at,
      post_id: data.post_id,
      author_username: data.author?.username ?? null,
      author_display_name: data.author?.display_name ?? null,
    };
  }

  // profile
  const { data } = await supabase
    .from("profiles")
    .select("username, display_name, bio, avatar_url")
    .eq("id", targetId)
    .maybeSingle();
  if (!data) return null;
  return {
    type: "profile" as const,
    username: data.username,
    display_name: data.display_name,
    bio: data.bio,
    avatar_url: data.avatar_url,
  };
}

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
  const contentSnapshot = await captureContentSnapshot(supabase, targetType, targetId);

  const { error } = await supabase.from("reports").insert({
    reporter_profile_id: profile.id,
    target_type: targetType,
    target_id: targetId,
    reason: trimmedReason,
    status: "pending",
    content_snapshot: contentSnapshot,
  });

  if (error) {
    console.error("Failed to submit report", error);
    return { error: "Couldn't submit your report. Try again." };
  }

  revalidatePath("/admin/moderation");
  return { error: null };
}
