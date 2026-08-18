"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import { LogOut, Settings, UserRound } from "lucide-react";
import type { ViewerProfileSummary } from "./app-shell";
import { signOut } from "@/app/(app)/session-actions";
import { useFocusTrap } from "@/hooks/use-focus-trap";

/**
 * KIVO's own account menu, replacing Clerk's `<UserButton>` (removed
 * 2026-08-18 with the rest of Clerk — see DECISIONS.md).
 *
 * `<UserButton>` rendered inside Clerk's component tree with a palette handed
 * to it per theme by a `ClerkProvider appearance={...}` wrapper, because it
 * could not read KIVO's CSS variables. This is plain KIVO markup, so it
 * inherits `--surface-*`/`--hairline-*`/`--foreground-*` like every other
 * surface in the app and needs no per-theme JavaScript at all: light and dark
 * both fall out of the same tokens.
 *
 * Identity shown here is the real `profiles` row resolved server-side in
 * `(app)/layout.tsx` and threaded down through `AppShell` → `TopBar` — the
 * same `ViewerProfileSummary` the mobile "More" sheet header already renders,
 * never a placeholder name or avatar. Email is deliberately not shown: KIVO
 * does not store it (Supabase Auth owns it), so there is nothing real to put
 * there.
 *
 * Structure/behaviour deliberately mirrors `NotificationBell` — the same
 * `.kivo-popover` surface, the same spring transition, the same shared
 * `useFocusTrap` (Escape to close, Tab trapped inside, focus restored to the
 * trigger), and the same click-outside handler — so the two controls sitting
 * next to each other in the top bar behave identically.
 */
export function AccountMenu({ viewer }: { viewer: ViewerProfileSummary }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useFocusTrap(open, menuRef, () => setOpen(false), { restoreFocusRef: triggerRef });

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const name = viewer.displayName || `@${viewer.username}`;

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      {/* h-10 w-10 matches NotificationBell's trigger exactly, so the two sit
          on one optical line in the top bar. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Account menu for ${name}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-hairline bg-surface-2 transition-colors hover:border-hairline-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        {viewer.avatarUrl ? (
          <Image src={viewer.avatarUrl} alt="" width={40} height={40} className="h-full w-full object-cover" unoptimized />
        ) : (
          <UserRound className="h-[18px] w-[18px] text-foreground-muted" strokeWidth={1.75} />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            role="dialog"
            aria-label="Account"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 500, damping: 40 }}
            className="kivo-popover absolute right-0 top-11 z-30 w-60 overflow-hidden rounded-2xl"
          >
            <Link
              href={`/u/${viewer.username}`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 border-b border-hairline-soft px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2">
                {viewer.avatarUrl ? (
                  <Image src={viewer.avatarUrl} alt="" width={40} height={40} className="h-full w-full object-cover" unoptimized />
                ) : (
                  <UserRound className="h-5 w-5 text-foreground-muted" strokeWidth={1.75} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{name}</span>
                <span className="block truncate text-xs text-foreground-subtle">View profile</span>
              </span>
            </Link>

            <div className="flex flex-col p-1.5">
              <Link
                href="/settings"
                onClick={() => setOpen(false)}
                className="kivo-menu-item text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
              >
                <Settings className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                Settings
              </Link>

              <button
                type="button"
                disabled={pending}
                aria-busy={pending}
                onClick={() => startTransition(async () => { await signOut(); })}
                className="kivo-menu-item text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
              >
                <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                {pending ? "Signing out…" : "Sign out"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
