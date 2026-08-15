"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  getUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/app/(app)/notifications/actions";
import type { NotificationRow } from "@/lib/notifications";
import { describeNotification, notificationHref, notificationIcon } from "@/lib/notification-registry";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";
import { useFocusTrap } from "@/hooks/use-focus-trap";

/** Same UTC-day-boundary pattern used elsewhere (e.g. home/page.tsx) so
 * "Today" lines up with how the rest of the app buckets same-day activity. */
function startOfTodayUTC(): number {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  return start.getTime();
}

function groupByRecency(notifications: NotificationRow[]): { today: NotificationRow[]; earlier: NotificationRow[] } {
  const boundary = startOfTodayUTC();
  const today: NotificationRow[] = [];
  const earlier: NotificationRow[] = [];
  for (const notification of notifications) {
    if (new Date(notification.created_at).getTime() >= boundary) {
      today.push(notification);
    } else {
      earlier.push(notification);
    }
  }
  return { today, earlier };
}

type NotificationState = { notifications: NotificationRow[]; unreadCount: number };
type ReadAction = { type: "read"; id: string } | { type: "read-all" };

function applyRead(state: NotificationState, action: ReadAction): NotificationState {
  if (action.type === "read-all") {
    return {
      unreadCount: 0,
      notifications: state.notifications.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })),
    };
  }
  const target = state.notifications.find((n) => n.id === action.id);
  if (!target || target.read_at) return state;
  return {
    unreadCount: Math.max(0, state.unreadCount - 1),
    notifications: state.notifications.map((n) => (n.id === action.id ? { ...n, read_at: new Date().toISOString() } : n)),
  };
}

export function NotificationBell({
  initialNotifications,
  initialUnreadCount,
}: {
  initialNotifications: NotificationRow[];
  initialUnreadCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, applyOptimisticRead] = useOptimistic(
    { notifications: initialNotifications, unreadCount: initialUnreadCount },
    applyRead,
  );
  const [, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);
  const bellButtonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Item 126: the badge otherwise only reflects reality on a full page load
  // (initialUnreadCount is a server-render-time prop). `null` means "no
  // fresher number yet, trust the optimistic/base count"; it's reset back to
  // null whenever `initialUnreadCount` itself changes (a real server render
  // — e.g. the revalidatePath a mark-read action triggers — is authoritative
  // again at that point) or when the user marks something read locally (the
  // optimistic reducer below already accounts for that click). Resetting
  // during render (React's documented "adjusting state when a prop changes"
  // pattern) rather than in a useEffect avoids an extra cascading render.
  const [focusSyncedUnreadCount, setFocusSyncedUnreadCount] = useState<number | null>(null);
  const [prevInitialUnreadCount, setPrevInitialUnreadCount] = useState(initialUnreadCount);
  if (initialUnreadCount !== prevInitialUnreadCount) {
    setPrevInitialUnreadCount(initialUnreadCount);
    setFocusSyncedUnreadCount(null);
  }

  // Purely event-driven (real tab-focus events only) — no polling/cron, per
  // the $0-budget rule. A backgrounded tab can miss a like/comment that
  // arrived while it wasn't active; this catches the badge up the moment the
  // user actually looks at it again.
  useEffect(() => {
    function refreshUnreadCount() {
      if (document.visibilityState !== "visible") return;
      getUnreadNotificationCount()
        .then(setFocusSyncedUnreadCount)
        .catch(() => {});
    }
    window.addEventListener("focus", refreshUnreadCount);
    document.addEventListener("visibilitychange", refreshUnreadCount);
    return () => {
      window.removeEventListener("focus", refreshUnreadCount);
      document.removeEventListener("visibilitychange", refreshUnreadCount);
    };
  }, []);

  const displayUnreadCount = focusSyncedUnreadCount ?? state.unreadCount;

  // Trap + Escape-to-close + focus restore to the bell button, same shared
  // pattern used across every dialog surface in the app.
  useFocusTrap(open, dropdownRef, () => setOpen(false), { restoreFocusRef: bellButtonRef });

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function handleItemClick(id: string) {
    setFocusSyncedUnreadCount(null);
    setOpen(false);
    startTransition(async () => {
      applyOptimisticRead({ type: "read", id });
      await markNotificationRead(id);
    });
  }

  function handleMarkAllRead() {
    setFocusSyncedUnreadCount(null);
    startTransition(async () => {
      applyOptimisticRead({ type: "read-all" });
      await markAllNotificationsRead();
    });
  }

  const { today, earlier } = groupByRecency(state.notifications);

  // Item 122/123/124: a real link to the notification's target (post, match,
  // profile, ...) via the typed registry, not a dead "mark read" button — the
  // click marks it read (same handler, fire-and-forget alongside the
  // navigation) AND follows the link in one action.
  function renderItem(notification: NotificationRow) {
    const Icon = notificationIcon(notification);
    return (
      <Link
        key={notification.id}
        href={notificationHref(notification)}
        onClick={() => handleItemClick(notification.id)}
        className={cn(
          "flex w-full items-start gap-3 border-b border-white/5 px-4 py-3 text-left transition-colors last:border-0 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-kivo-cyan/60",
          !notification.read_at && "bg-white/[0.03]",
        )}
      >
        <div className="kivo-gradient-prime mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
          <Icon className="h-3.5 w-3.5 text-kivo-white" strokeWidth={2} />
        </div>
        <div className="flex-1">
          <p className="text-sm text-foreground">{describeNotification(notification)}</p>
          <p className="mt-0.5 text-xs text-foreground-subtle">{timeAgo(notification.created_at)}</p>
        </div>
        {!notification.read_at && (
          <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-kivo-cyan" />
        )}
      </Link>
    );
  }

  return (
    <div ref={panelRef} className="relative">
      <button
        ref={bellButtonRef}
        onClick={() => setOpen((v) => !v)}
        aria-label={displayUnreadCount > 0 ? `Notifications, ${displayUnreadCount} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
      >
        <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
        {displayUnreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[10px] font-semibold text-kivo-white"
          >
            {displayUnreadCount > 9 ? "9+" : displayUnreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={dropdownRef}
            role="dialog"
            aria-label="Notifications"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 500, damping: 40 }}
            className="kivo-glass-brand fixed left-4 right-4 top-16 z-30 max-h-[70vh] overflow-hidden rounded-2xl sm:absolute sm:left-auto sm:right-0 sm:top-11 sm:max-h-none sm:w-80"
          >
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
              <span className="text-sm font-semibold text-foreground">Notifications</span>
              {displayUnreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="rounded text-xs font-medium text-kivo-cyan hover:text-kivo-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {state.notifications.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-foreground-muted">You&apos;re all caught up.</p>
              ) : (
                <>
                  {today.length > 0 && (
                    <div>
                      <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                        Today
                      </p>
                      {today.map(renderItem)}
                    </div>
                  )}
                  {earlier.length > 0 && (
                    <div>
                      <p className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                        Earlier
                      </p>
                      {earlier.map(renderItem)}
                    </div>
                  )}
                </>
              )}
            </div>
            {/* Item 125: the panel caps at 20 (see getRecentNotifications) with
                no way to reach the rest — a real, paginated /notifications page. */}
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="block border-t border-white/5 px-4 py-2.5 text-center text-xs font-medium text-kivo-cyan hover:text-kivo-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-kivo-cyan/60"
            >
              See all notifications
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
