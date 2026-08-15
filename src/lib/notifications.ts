import "server-only";
import { createServerSupabaseClient } from "./supabase/server";
import { getOrCreateProfile } from "./profile";
import type { Database } from "./supabase/types";

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
      .is("read_at", null),
  ]);

  return { notifications: notifications ?? [], unreadCount: unreadCount ?? 0 };
}
