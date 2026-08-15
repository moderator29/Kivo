"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { X, Menu } from "lucide-react";
import { ADMIN_NAV_ITEM, NAV_ITEMS, isActiveRoute } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/hooks/use-focus-trap";

// RECOMMENDATIONS item 131: matches, predictions and fantasy are all real,
// working features now (not the "Fantasy is unreachable" state the item was
// originally written against), so this is re-picked for what matchday users
// actually reach for most: live scores, browsing fixtures, the social feed,
// and predictions. "home" drops out of the primary four but stays one tap
// away via the KIVO logo in TopBar (always visible on mobile, see
// top-bar.tsx) — it isn't stranded, just no longer duplicated here. Fantasy
// moves into "More", same as matches/predictions were before this change.
const BOTTOM_BAR_IDS = ["live", "matches", "social", "predictions"];

export function MobileBottomNav({ aiConfigured, isAdmin }: { aiConfigured: boolean; isAdmin: boolean }) {
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
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
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
              className="kivo-glass-brand relative z-10 mb-[calc(env(safe-area-inset-bottom)+76px)] mx-3 max-h-[70vh] overflow-y-auto rounded-2xl p-3"
            >
              <div className="grid grid-cols-2 gap-2">
                {moreItems.map((item) => {
                  const active = isActiveRoute(pathname, item.href);
                  const Icon = item.icon;
                  const isComingSoon = item.status === "coming-soon" && !(item.id === "ai" && aiConfigured);
                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setMoreOpen(false)}
                      className="group relative flex items-center gap-3 rounded-2xl px-2.5 py-2.5 transition-colors hover:bg-white/[0.06] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
                    >
                      <span
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all",
                          active
                            ? "kivo-gradient-prime shadow-[0_0_16px_-2px_rgba(0,217,255,0.55)]"
                            : "bg-white/[0.05] group-hover:bg-white/[0.08]",
                        )}
                      >
                        <Icon
                          className={cn(
                            "h-5 w-5 transition-colors",
                            active ? "text-kivo-white" : "text-foreground-subtle group-hover:text-foreground-muted",
                          )}
                          strokeWidth={1.75}
                        />
                      </span>
                      <span className="flex min-w-0 flex-col items-start gap-0.5">
                        <span
                          className={cn(
                            "truncate text-[13px] font-semibold transition-colors",
                            active ? "text-kivo-cyan" : "text-foreground",
                          )}
                        >
                          {item.label}
                        </span>
                        {isComingSoon && (
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                            Soon
                          </span>
                        )}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <nav
        className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-30 lg:hidden"
        aria-label="Primary"
      >
        <div className="kivo-glass-brand flex items-center justify-around gap-1 rounded-full p-1.5 shadow-[0_8px_30px_-8px_rgba(0,0,0,0.6)]">
          {barItems.map((item) => {
            const active = isActiveRoute(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-[13px] font-semibold transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60",
                  active ? "text-kivo-white" : "text-foreground-subtle hover:text-foreground-muted",
                )}
              >
                {active && (
                  <motion.span
                    aria-hidden="true"
                    layoutId="mobile-nav-active"
                    className="kivo-gradient-prime absolute inset-0 rounded-full shadow-[0_0_16px_-2px_rgba(0,217,255,0.55)]"
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
              "relative flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-[13px] font-semibold transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60",
              moreOpen ? "text-kivo-white" : "text-foreground-subtle hover:text-foreground-muted",
            )}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
          >
            {moreOpen && (
              <motion.span
                aria-hidden="true"
                layoutId="mobile-nav-active"
                className="kivo-gradient-prime absolute inset-0 rounded-full shadow-[0_0_16px_-2px_rgba(0,217,255,0.55)]"
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
