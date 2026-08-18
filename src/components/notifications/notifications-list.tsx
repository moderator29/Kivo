"use client";

import { useOptimistic, useTransition } from "react";
import Link from "next/link";
import { Check, CheckCheck } from "lucide-react";
import { markAllNotificationsRead, markNotificationRead } from "@/app/(app)/notifications/actions";
import type { NotificationRow } from "@/lib/notifications";
import { describeNotification, notificationHref, notificationIcon } from "@/lib/notification-registry";
import { RelativeTime } from "@/components/ui/relative-time";
import { cn } from "@/lib/utils";

type ReadAction = { type: "read"; id: string } | { type: "read-all" };

function applyRead(notifications: NotificationRow[], action: ReadAction): NotificationRow[] {
  if (action.type === "read-all") {
    return notifications.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() }));
  }
  return notifications.map((n) => (n.id === action.id && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n));
}

/**
 * The `/notifications` page's client half (item 125). Same typed-registry
 * icon/title/href and same "click marks it read AND navigates" behaviour as
 * NotificationBell's dropdown (src/components/layout/notification-bell.tsx),
 * just as a flat paginated list instead of a popover — kept as a separate,
 * simpler component rather than sharing one generic list renderer, since the
 * bell also owns the popover shell, focus trap, and live unread badge that
 * have no equivalent here.
 */
export function NotificationsList({ notifications }: { notifications: NotificationRow[] }) {
  const [optimisticNotifications, applyOptimisticRead] = useOptimistic(notifications, applyRead);
  const [, startTransition] = useTransition();
  const hasUnread = optimisticNotifications.some((n) => !n.read_at);

  function handleItemClick(id: string) {
    startTransition(async () => {
      applyOptimisticRead({ type: "read", id });
      await markNotificationRead(id);
    });
  }

  function handleMarkAllRead() {
    startTransition(async () => {
      applyOptimisticRead({ type: "read-all" });
      await markAllNotificationsRead();
    });
  }

  // KN-49: the number is the point. "Mark all read" said nothing about what
  // "all" was, and the only way to clear one notification was to open it —
  // so a bell full of goals could only be emptied by visiting every match.
  const unreadCount = optimisticNotifications.filter((n) => !n.read_at).length;

  function handleMarkOneRead(id: string) {
    startTransition(async () => {
      applyOptimisticRead({ type: "read", id });
      await markNotificationRead(id);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {hasUnread && (
        <button
          onClick={handleMarkAllRead}
          className="flex items-center gap-1.5 self-end rounded text-xs font-medium text-accent hover:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <CheckCheck className="h-3.5 w-3.5" strokeWidth={2} />
          {/* Says how many, and says it about *your unread notifications*, not
              about the page — markAllNotificationsRead clears every unread row
              this profile has, including ones further back than this page. */}
          Mark {unreadCount === 1 ? "1 notification" : `all ${unreadCount} notifications`} as read
        </button>
      )}
      <div className="kivo-glass flex flex-col overflow-hidden rounded-2xl">
        {optimisticNotifications.map((notification) => {
          const Icon = notificationIcon(notification);
          const unread = !notification.read_at;
          return (
            <div
              key={notification.id}
              className={cn(
                "flex items-start border-b border-hairline-soft transition-colors last:border-0",
                unread && "bg-accent-soft",
              )}
            >
              <Link
                href={notificationHref(notification)}
                onClick={() => handleItemClick(notification.id)}
                className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
              >
                <div className="kivo-gradient-prime mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                  <Icon className="h-4 w-4 text-on-accent" strokeWidth={1.75} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">
                    {/* Bug 7 (audit): same accessible-unread-marker fix as
                        NotificationBell's renderItem — the visible dot below is
                        aria-hidden, so this is the only signal AT users get. */}
                    {unread && <span className="sr-only">Unread. </span>}
                    {describeNotification(notification)}
                  </p>
                  <RelativeTime iso={notification.created_at} className="mt-0.5 block text-xs text-foreground-subtle" />
                </div>
              </Link>

              {/* KN-49: the unread dot *is* the control. Marking one thing read
                  without opening it was impossible before this; making the
                  existing indicator the button adds an affordance without
                  adding a second glyph to every row. A read row renders a
                  fixed-width spacer instead, so the text column doesn't shift
                  by 40px the moment something is marked read. */}
              {unread ? (
                <button
                  type="button"
                  onClick={() => handleMarkOneRead(notification.id)}
                  aria-label="Mark as read"
                  title="Mark as read"
                  className="group relative mt-2.5 mr-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 rounded-full bg-accent transition-opacity group-hover:opacity-0"
                  />
                  <Check
                    aria-hidden="true"
                    className="absolute h-4 w-4 text-accent opacity-0 transition-opacity group-hover:opacity-100"
                    strokeWidth={1.75}
                  />
                </button>
              ) : (
                <span aria-hidden="true" className="mr-2 h-9 w-9 shrink-0" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
