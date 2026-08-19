import "server-only";
import { createServerSupabaseClient } from "./supabase/server";
import { getOrCreateProfile } from "./profile";
import type { Database } from "./supabase/types";
import { blockedActorUsernames, notificationIsFromBlockedActor } from "./blocks";

export type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

export async function getRecentNotifications(): Promise<{ notifications: NotificationRow[]; unreadCount: number }> {
  const profile = await getOrCreateProfile();
  if (!profile) return { notifications: [], unreadCount: 0 };

  const supabase = createServerSupabaseClient();
  const [{ data: notifications }, { count: unreadCount }] = await Promise.all([
    supabase
      .from("notifications")
      .select("*")
      .eq("profile_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("profile_id", profile.id)
      .is("read_at", null)
      // Migration 0088. The badge is the only thing in KIVO that interrupts
      // anybody, so it is the only thing quiet hours act on. A row produced
      // inside the recipient's quiet window is still in the list below, still
      // unread, and simply does not tap them on the shoulder until the window
      // ends — at which point everything from that window appears together,
      // because they all carry the same `quiet_until`.
      .or(`quiet_until.is.null,quiet_until.lte.${new Date().toISOString()}`),
  ]);

  // Migration 0086: the bell is filtered the same way /notifications is —
  // rows from an account the caller has blocked, produced before the block
  // existed, are dropped from the caller's own view. The unread count is
  // deliberately NOT adjusted: it is a real count of unread rows, and quietly
  // shrinking it would leave a badge that disagrees with the list it opens.
  const blockedUsernames = await blockedActorUsernames();
  const visible = (notifications ?? []).filter(
    (notification) => !notificationIsFromBlockedActor(notification.payload, blockedUsernames),
  );

  return { notifications: visible, unreadCount: unreadCount ?? 0 };
}
