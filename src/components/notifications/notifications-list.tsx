"use client";

import { useOptimistic, useTransition } from "react";
import Link from "next/link";
import { markAllNotificationsRead, markNotificationRead } from "@/app/(app)/notifications/actions";
import type { NotificationRow } from "@/lib/notifications";
import { describeNotification, notificationHref, notificationIcon } from "@/lib/notification-registry";
import { timeAgo } from "@/lib/format";
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

  return (
    <div className="flex flex-col gap-3">
      {hasUnread && (
        <button
          onClick={handleMarkAllRead}
          className="self-end rounded text-xs font-medium text-accent hover:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          Mark all read
        </button>
      )}
      <div className="kivo-glass flex flex-col overflow-hidden rounded-2xl">
        {optimisticNotifications.map((notification) => {
          const Icon = notificationIcon(notification);
          return (
            <Link
              key={notification.id}
              href={notificationHref(notification)}
              onClick={() => handleItemClick(notification.id)}
              className={cn(
                "flex items-start gap-3 border-b border-hairline-soft px-4 py-3.5 text-left transition-colors last:border-0 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60",
                !notification.read_at && "bg-accent-soft",
              )}
            >
              <div className="kivo-gradient-prime mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                <Icon className="h-4 w-4 text-on-accent" strokeWidth={2} />
              </div>
              <div className="flex-1">
                <p className="text-sm text-foreground">
                  {/* Bug 7 (audit): same accessible-unread-marker fix as
                      NotificationBell's renderItem — the visible dot below is
                      aria-hidden, so this is the only signal AT users get. */}
                  {!notification.read_at && <span className="sr-only">Unread. </span>}
                  {describeNotification(notification)}
                </p>
                <p className="mt-0.5 text-xs text-foreground-subtle">{timeAgo(notification.created_at)}</p>
              </div>
              {!notification.read_at && (
                <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
