import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { FadeIn } from "@/components/ui/fade-in";
import { NotificationsList } from "@/components/notifications/notifications-list";

export const metadata: Metadata = { title: "Notifications" };

// Item 125: the bell dropdown caps at 20 (getRecentNotifications) with no way
// to reach the rest. A plain `?page=` range query is enough for a "Small"
// item — no need for cursor pagination on a per-user table this size.
const PAGE_SIZE = 30;

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const profile = await getOrCreateProfile();
  if (!profile) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 px-6 py-24 text-center">
        <Bell className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
        <p className="text-sm text-foreground-muted">Sign up to see your notifications.</p>
        <Link
          href="/sign-up"
          className="kivo-gradient-prime rounded-xl px-5 py-2.5 text-sm font-semibold text-on-accent kivo-raise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Sign up
        </Link>
      </div>
    );
  }

  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Math.trunc(Number(pageParam)) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = createServerSupabaseClient();
  // notifications_select_own already scopes this to the caller via RLS; the
  // explicit .eq is belt-and-suspenders, same as getRecentNotifications().
  const { data: notifications, count } = await supabase
    .from("notifications")
    .select("*", { count: "exact" })
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false })
    .range(from, to);

  const total = count ?? 0;
  const hasPrev = page > 1;
  const hasNext = from + PAGE_SIZE < total;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8 lg:px-8">
      <FadeIn>
        <h1 className="text-xl font-semibold text-foreground">Notifications</h1>
      </FadeIn>

      {!notifications || notifications.length === 0 ? (
        <FadeIn delay={0.06} className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-10 text-center">
          <Bell className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
          <p className="text-sm text-foreground-muted">
            {page > 1 ? "Nothing on this page." : "You're all caught up. Nothing here yet."}
          </p>
        </FadeIn>
      ) : (
        <FadeIn delay={0.06}>
          <NotificationsList notifications={notifications} />
        </FadeIn>
      )}

      {(hasPrev || hasNext) && (
        <FadeIn delay={0.1} className="flex items-center justify-between pt-1">
          {hasPrev ? (
            <Link
              href={page - 1 > 1 ? `/notifications?page=${page - 1}` : "/notifications"}
              className="rounded text-xs font-medium text-accent hover:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              Newer
            </Link>
          ) : (
            <span />
          )}
          {hasNext ? (
            <Link
              href={`/notifications?page=${page + 1}`}
              className="rounded text-xs font-medium text-accent hover:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              Older
            </Link>
          ) : (
            <span />
          )}
        </FadeIn>
      )}
    </div>
  );
}
