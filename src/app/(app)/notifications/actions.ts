"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";

export async function markNotificationRead(notificationId: string) {
  const profile = await getOrCreateProfile();
  if (!profile) return;

  const supabase = createServerSupabaseClient();
  // Goes through the mark_notifications_read RPC rather than a raw
  // `.update()` (RECOMMENDATIONS item 38) — notifications has no client-facing
  // UPDATE policy any more, so a raw update would silently touch zero rows.
  // The RPC only ever sets read_at, scoped server-side to the caller's own
  // profile.
  await supabase.rpc("mark_notifications_read", { p_notification_ids: [notificationId] });
  revalidatePath("/", "layout");
}

export async function markAllNotificationsRead() {
  const profile = await getOrCreateProfile();
  if (!profile) return;

  const supabase = createServerSupabaseClient();
  const { data: unread } = await supabase
    .from("notifications")
    .select("id")
    .eq("profile_id", profile.id)
    .is("read_at", null);

  const ids = (unread ?? []).map((n) => n.id);
  if (ids.length > 0) {
    await supabase.rpc("mark_notifications_read", { p_notification_ids: ids });
  }
  revalidatePath("/", "layout");
}

/**
 * Cheap, count-only refresh for NotificationBell's focus/visibility listener
 * (item 126 — the badge was only ever correct on a full page load, no
 * polling/cron per the $0-budget rule, so this only runs on real tab-focus
 * events). Deliberately not `getRecentNotifications()` — no need to re-fetch
 * and re-render the whole list just to catch a stale badge number.
 */
export async function getUnreadNotificationCount(): Promise<number> {
  const profile = await getOrCreateProfile();
  if (!profile) return 0;

  const supabase = createServerSupabaseClient();
  const { count } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("profile_id", profile.id)
    .is("read_at", null);
  return count ?? 0;
}
