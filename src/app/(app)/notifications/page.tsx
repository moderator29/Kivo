import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readList } from "@/lib/query-result";
import { LoadFailed } from "@/components/ui/load-failed";
import { getOrCreateProfile } from "@/lib/profile";
import { FadeIn } from "@/components/ui/fade-in";
import { NotificationsList } from "@/components/notifications/notifications-list";
import { NOTIFICATION_GROUPS, notificationGroup } from "@/lib/notification-registry";
import { getNotificationFantasyContext } from "@/lib/football/notification-fantasy-context";
import { blockedActorUsernames, notificationIsFromBlockedActor } from "@/lib/blocks";
import { cn } from "@/lib/utils";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";

export const metadata: Metadata = { title: "Notifications" };

// Item 125: the bell dropdown caps at 20 (getRecentNotifications) with no way
// to reach the rest. A plain `?page=` range query is enough for a "Small"
// item — no need for cursor pagination on a per-user table this size.
const PAGE_SIZE = 30;

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; type?: string }>;
}) {
  const profile = await getOrCreateProfile();
  // The (app) layout already guarantees a signed-in viewer with a real profile
  // row, so a null here is not a guest — it is a transient read failure between
  // that check and this one. See src/lib/guest-preview.ts.
  if (!profile) return <ProfileUnavailable />;

  const { page: pageParam, type: typeParam } = await searchParams;
  const page = Math.max(1, Math.trunc(Number(pageParam)) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // KN-48: filtering happens in the query, not in the browser. Filtering the
  // 30 rows of the current page client-side would show "Social" as empty for a
  // user whose replies are simply on page 3 — a filter that lies about what
  // you have is worse than no filter.
  const activeGroup = notificationGroup(typeParam);

  const supabase = createServerSupabaseClient();
  // notifications_select_own already scopes this to the caller via RLS; the
  // explicit .eq is belt-and-suspenders, same as getRecentNotifications().
  let query = supabase
    .from("notifications")
    .select("*", { count: "exact" })
    .eq("profile_id", profile.id);
  if (activeGroup) query = query.in("type", [...activeGroup.types]);

  // One real head-count per group, in parallel. Chips carry the true number
  // and a group with nothing in it is not rendered at all — so the filter row
  // only ever offers filters that lead somewhere.
  const [notificationsResult, groupCounts, blockedUsernames] = await Promise.all([
    query.order("created_at", { ascending: false }).range(from, to),
    Promise.all(
      NOTIFICATION_GROUPS.map(async (group) => {
        const { count: groupCount } = await supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("profile_id", profile.id)
          .in("type", [...group.types]);
        return { group, count: groupCount ?? 0 };
      }),
    ),
    blockedActorUsernames(),
  ]);

  // Migration 0086. Rows produced before a block was made are dropped from the
  // blocker's own list here — new ones are never written at all (see
  // blockExistsBetween). Filtered after the page query rather than inside it
  // because the join key is a username inside a jsonb payload, and the counts
  // above stay honest about what is really stored: a page that shows 28 of its
  // 30 rows is telling the truth, whereas a count corrected to hide the
  // difference would be inventing one.
  // "You have no notifications" is a claim about this person, not about the
  // database, and it is the kind of sentence a reader acts on by leaving. A
  // failed read must never be allowed to make it.
  const notificationsOutcome = readList(notificationsResult, "notifications.page");
  const count = notificationsResult.count;

  const notifications = notificationsOutcome.rows.filter(
    (notification) => !notificationIsFromBlockedActor(notification.payload, blockedUsernames),
  );

  // KN-45: a goal by the viewer's own captain should not read identically to
  // a goal by somebody they have never heard of. Computed at read time from
  // the current squad (see getNotificationFantasyContext for why not at write
  // time), bounded to the page on screen, and empty for anyone without a
  // fantasy team — in which case every row renders exactly as before.
  const fantasyContext = await getNotificationFantasyContext(supabase, profile.id, notifications);

  const visibleGroups = groupCounts.filter((entry) => entry.count > 0);
  const totalAcrossGroups = groupCounts.reduce((sum, entry) => sum + entry.count, 0);

  function filterHref(groupId: string | null) {
    return groupId ? `/notifications?type=${groupId}` : "/notifications";
  }

  const total = count ?? 0;
  const hasPrev = page > 1;
  const hasNext = from + PAGE_SIZE < total;

  return (
    <div className="kivo-page">
      <FadeIn>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Notifications</h1>
      </FadeIn>

      {/* Only rendered once there is more than one thing to choose between —
          a single chip is a label pretending to be a control. */}
      {visibleGroups.length > 1 && (
        <FadeIn delay={0.03} className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
          <div className="flex w-max gap-2">
            <FilterChip href={filterHref(null)} label="All" count={totalAcrossGroups} active={!activeGroup} />
            {visibleGroups.map((entry) => (
              <FilterChip
                key={entry.group.id}
                href={filterHref(entry.group.id)}
                label={entry.group.label}
                count={entry.count}
                active={activeGroup?.id === entry.group.id}
              />
            ))}
          </div>
        </FadeIn>
      )}

      {notificationsOutcome.failed ? (
        <LoadFailed
          tone="section"
          title="Your notifications"
          description="KIVO couldn't read your notifications just now. They haven't gone anywhere — try again."
        />
      ) : notifications.length === 0 ? (
        <FadeIn delay={0.06} className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-10 text-center">
          <Bell className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
          <p className="text-sm text-foreground-muted">
            {page > 1
              ? "Nothing on this page."
              : activeGroup
                ? `Nothing under ${activeGroup.label} yet.`
                : "You're all caught up. Nothing here yet."}
          </p>
        </FadeIn>
      ) : (
        <FadeIn delay={0.06}>
          <NotificationsList
            notifications={notifications}
            fantasyContext={Object.fromEntries(fantasyContext)}
          />
        </FadeIn>
      )}

      {(hasPrev || hasNext) && (
        <FadeIn delay={0.1} className="flex items-center justify-between pt-1">
          {hasPrev ? (
            <Link
              href={
                page - 1 > 1
                  ? `/notifications?page=${page - 1}${activeGroup ? `&type=${activeGroup.id}` : ""}`
                  : filterHref(activeGroup?.id ?? null)
              }
              className="rounded text-xs font-medium text-accent hover:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              Newer
            </Link>
          ) : (
            <span />
          )}
          {hasNext ? (
            <Link
              href={`/notifications?page=${page + 1}${activeGroup ? `&type=${activeGroup.id}` : ""}`}
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

/** A notification filter chip. Sharp-cornered and hairline-bordered rather
 * than a pill — this is a control, and KIVO's controls are square-shouldered. */
function FilterChip({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        active
          ? "border-accent/50 bg-accent-soft text-foreground"
          : "border-hairline text-foreground-muted hover:bg-surface-2",
      )}
    >
      {label}
      <span className={cn("tabular-nums", active ? "text-accent" : "text-foreground-subtle")}>{count}</span>
    </Link>
  );
}
