"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { X, Menu, ChevronRight, UserRound } from "lucide-react";
import { ADMIN_NAV_ITEM, NAV_ITEMS, isActiveRoute, type NavItem } from "@/lib/navigation";
import { SIDEBAR_GROUPS } from "./desktop-sidebar";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import type { ViewerProfileSummary } from "./app-shell";

// RECOMMENDATIONS item 131: matches, predictions and fantasy are all real,
// working features now (not the "Fantasy is unreachable" state the item was
// originally written against), so this is re-picked for what matchday users
// actually reach for most: live scores, browsing fixtures, the social feed,
// and predictions. "home" drops out of the primary four but stays one tap
// away via the KIVO logo in TopBar (always visible on mobile, see
// top-bar.tsx) — it isn't stranded, just no longer duplicated here. Fantasy
// moves into "More", same as matches/predictions were before this change.
const BOTTOM_BAR_IDS = ["live", "matches", "social", "predictions"];

export function MobileBottomNav({
  aiConfigured,
  isAdmin,
  viewerProfile,
}: {
  aiConfigured: boolean;
  isAdmin: boolean;
  viewerProfile: ViewerProfileSummary | null;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const barItems = NAV_ITEMS.filter((item) => BOTTOM_BAR_IDS.includes(item.id));
  const moreItems = NAV_ITEMS.filter((item) => !BOTTOM_BAR_IDS.includes(item.id));
  // Item 134: no link to /admin anywhere in the app shell — appended here,
  // gated on role, rather than folded into NAV_ITEMS (which every guest
  // enumerates unconditionally).
  if (isAdmin) moreItems.push(ADMIN_NAV_ITEM);

  // Same section grouping as the desktop sidebar (SIDEBAR_GROUPS), filtered
  // down to whichever of those items actually landed in "More" here (the
  // four items already pinned to the bottom bar drop out of their groups
  // rather than appearing twice).
  const moreGroups = SIDEBAR_GROUPS.map((group) => ({
    label: group.label,
    items: group.ids
      .map((id) => moreItems.find((item) => item.id === id))
      .filter((item): item is NavItem => Boolean(item)),
  })).filter((group) => group.items.length > 0);
  const homeItem = moreItems.find((item) => item.id === "home");
  if (isAdmin) moreGroups.push({ label: "Admin", items: [ADMIN_NAV_ITEM] });

  useFocusTrap(moreOpen, panelRef, () => setMoreOpen(false), { restoreFocusRef: toggleButtonRef });

  useEffect(() => {
    if (!moreOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [moreOpen]);

  return (
    <>
      <AnimatePresence>
        {moreOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 flex flex-col justify-end lg:hidden"
          >
            {/* Non-focusable backdrop (RECOMMENDATIONS.md item 149): a real
                `<button>` here sat in tab/reading order before the sheet's
                own nav links, so a screen reader user hit an unlabelled-in-
                context "Close menu" control before anything else in the
                dialog. The panel already has real, focusable nav links to
                tab through, and Escape (via useFocusTrap) closes it too. */}
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-overlay backdrop-blur-sm"
              onClick={() => setMoreOpen(false)}
            />
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label="More navigation"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 36 }}
              className="kivo-glass-brand relative z-10 mb-[calc(env(safe-area-inset-bottom)+76px)] mx-3 flex max-h-[75vh] flex-col overflow-hidden rounded-3xl pt-2.5"
            >
              <div aria-hidden="true" className="mx-auto h-1 w-9 shrink-0 rounded-full bg-surface-2" />

              <div className="flex flex-col overflow-y-auto px-3 pb-3">
                {viewerProfile && (
                  <div className="mt-2 flex items-center gap-3 px-1 pb-3">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-1">
                      {viewerProfile.avatarUrl ? (
                        <Image src={viewerProfile.avatarUrl} alt="" width={48} height={48} className="h-full w-full object-cover" unoptimized />
                      ) : (
                        <UserRound className="h-6 w-6 text-foreground-subtle" strokeWidth={1.75} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{viewerProfile.displayName || `@${viewerProfile.username}`}</p>
                      <p className="truncate text-xs text-foreground-subtle">@{viewerProfile.username}</p>
                    </div>
                    <Link
                      href="/settings"
                      onClick={() => setMoreOpen(false)}
                      className="kivo-glass-sharp shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold text-foreground transition active:scale-95"
                    >
                      Manage
                    </Link>
                  </div>
                )}

                {homeItem && (
                  <div className="flex flex-col pb-1.5">
                    <MoreRow item={homeItem} pathname={pathname} aiConfigured={aiConfigured} onNavigate={() => setMoreOpen(false)} />
                  </div>
                )}

                {/* Grouped list, one hairline divider per section, generous
                    ~56-60px rows — same pattern as the desktop sidebar and
                    /settings' grouped card, no per-row box. */}
                <div className="kivo-glass flex flex-col rounded-2xl">
                  {moreGroups.map((group, index) => (
                    <div key={group.label} className={cn("flex flex-col py-1.5", index > 0 && "border-t border-hairline-soft")}>
                      <span className="px-3 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
                        {group.label}
                      </span>
                      {group.items.map((item) => (
                        <MoreRow key={item.id} item={item} pathname={pathname} aiConfigured={aiConfigured} onNavigate={() => setMoreOpen(false)} />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <nav
        className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-30 lg:hidden"
        aria-label="Primary"
      >
        <div className="kivo-glass-brand flex items-center justify-around gap-1 rounded-full p-1.5 shadow-float">
          {barItems.map((item) => {
            const active = isActiveRoute(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-[13px] font-semibold transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                  active ? "text-on-accent" : "text-foreground-subtle hover:text-foreground-muted",
                )}
              >
                {active && (
                  <motion.span
                    aria-hidden="true"
                    layoutId="mobile-nav-active"
                    className="kivo-gradient-prime absolute inset-0 rounded-full kivo-glow-soft"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
                <Icon className="relative z-10 h-5 w-5 shrink-0 transition-colors" strokeWidth={1.75} />
                {active && <span className="relative z-10 truncate">{item.label}</span>}
              </Link>
            );
          })}
          <button
            ref={toggleButtonRef}
            onClick={() => setMoreOpen((v) => !v)}
            className={cn(
              "relative flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-[13px] font-semibold transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
              moreOpen ? "text-on-accent" : "text-foreground-subtle hover:text-foreground-muted",
            )}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
          >
            {moreOpen && (
              <motion.span
                aria-hidden="true"
                layoutId="mobile-nav-active"
                className="kivo-gradient-prime absolute inset-0 rounded-full kivo-glow-soft"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
            )}
            {moreOpen ? (
              <X className="relative z-10 h-5 w-5 shrink-0 transition-colors" strokeWidth={1.75} />
            ) : (
              <Menu className="relative z-10 h-5 w-5 shrink-0 transition-colors" strokeWidth={1.75} />
            )}
            {moreOpen && <span className="relative z-10">Close</span>}
          </button>
        </div>
      </nav>
    </>
  );
}

/** One row of the "More" sheet's grouped list — icon left, bold label,
 * generous ~56px height, trailing chevron as a drill-down affordance (every
 * row here is a real navigation, so the chevron just signals "goes
 * somewhere" the same way the settings rows' chevrons do). */
function MoreRow({
  item,
  pathname,
  aiConfigured,
  onNavigate,
}: {
  item: NavItem;
  pathname: string | null;
  aiConfigured: boolean;
  onNavigate: () => void;
}) {
  const active = isActiveRoute(pathname, item.href);
  const Icon = item.icon;
  const isComingSoon = item.status === "coming-soon" && !(item.id === "ai" && aiConfigured);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className="group flex min-h-14 items-center gap-3 px-3.5 py-3 transition-colors active:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
    >
      <Icon
        className={cn("h-5 w-5 shrink-0 transition-colors", active ? "text-accent" : "text-foreground-subtle")}
        strokeWidth={1.75}
      />
      <span className={cn("flex-1 truncate text-sm", active ? "font-semibold text-foreground" : "font-medium text-foreground")}>
        {item.label}
      </span>
      {isComingSoon && (
        <span className="shrink-0 rounded-full border border-hairline px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          Soon
        </span>
      )}
      <ChevronRight className="h-4 w-4 shrink-0 text-foreground-subtle/60" strokeWidth={1.75} />
    </Link>
  );
}
