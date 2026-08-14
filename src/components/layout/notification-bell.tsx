"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { Bell, Heart } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { markAllNotificationsRead, markNotificationRead } from "@/app/notifications/actions";
import type { NotificationRow } from "@/lib/notifications";
import { cn } from "@/lib/utils";

function timeAgo(isoDate: string) {
  const seconds = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function describe(notification: NotificationRow): string {
  const payload = notification.payload as Record<string, unknown>;
  if (notification.type === "post_like") {
    const name = (payload.liker_display_name as string) || (payload.liker_username as string) || "Someone";
    return `${name} liked your post`;
  }
  return notification.type.replace(/_/g, " ");
}

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

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        // Unlike click-outside (which may land on another real, focusable
        // element the user meant to interact with), Escape has nowhere else
        // for focus to go, so return it to the bell rather than stranding
        // keyboard users on a now-hidden panel.
        bellButtonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      const firstFocusable = dropdownRef.current?.querySelector<HTMLElement>("a, button");
      firstFocusable?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [open]);

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

  const { today, earlier } = groupByRecency(state.notifications);

  function renderItem(notification: NotificationRow) {
    return (
      <button
        key={notification.id}
        onClick={() => handleItemClick(notification.id)}
        className={cn(
          "flex w-full items-start gap-3 border-b border-white/5 px-4 py-3 text-left transition-colors last:border-0 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-kivo-cyan/60",
          !notification.read_at && "bg-white/[0.03]",
        )}
      >
        <div className="kivo-gradient-prime mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full">
          <Heart className="h-3.5 w-3.5 text-kivo-white" strokeWidth={2} />
        </div>
        <div className="flex-1">
          <p className="text-sm text-foreground">{describe(notification)}</p>
          <p className="mt-0.5 text-xs text-foreground-subtle">{timeAgo(notification.created_at)}</p>
        </div>
        {!notification.read_at && (
          <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-kivo-cyan" />
        )}
      </button>
    );
  }

  return (
    <div ref={panelRef} className="relative">
      <button
        ref={bellButtonRef}
        onClick={() => setOpen((v) => !v)}
        aria-label={state.unreadCount > 0 ? `Notifications, ${state.unreadCount} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-foreground-muted transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
      >
        <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
        {state.unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[10px] font-semibold text-kivo-white"
          >
            {state.unreadCount > 9 ? "9+" : state.unreadCount}
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
              {state.unreadCount > 0 && (
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
