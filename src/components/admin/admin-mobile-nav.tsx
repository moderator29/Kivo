"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Menu, X } from "lucide-react";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { ADMIN_NAV, ADMIN_NAV_GROUPS, isAdminNavItemActive } from "@/lib/admin-nav";
import type { SupportQueueSignal } from "@/lib/admin/support-signal";
import { SupportBadge } from "@/components/admin/support-badge";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";
import kivoLogo from "../../../public/brand/kivo-logo-transparent.webp";

/**
 * Admin's navigation below `lg`, where the sidebar is hidden.
 *
 * Two things this now does that it did not. The bar names the page you are on —
 * on a phone the drawer is closed by definition, so the only thing on screen
 * used to be the word "KIVO Admin", identical on all nine pages. And the drawer
 * lists each item with the one line that says what it is for, because the
 * difference between "Coverage" and "Integrity" is not self-evident from four
 * words in a list.
 *
 * `permitted` is the set of hrefs this role can use — same set the sidebar gets,
 * resolved once in the layout.
 */
export function AdminMobileNav({
  permitted,
  supportSignal,
}: {
  permitted: string[];
  supportSignal: SupportQueueSignal | null;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const allowed = new Set(permitted);

  useFocusTrap(open, panelRef, () => setOpen(false), { restoreFocusRef: toggleRef });

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Longest match wins, so /admin/football/coverage names itself rather
  // than being labelled by the /admin item it happens to sit under.
  const current = ADMIN_NAV.filter((item) => isAdminNavItemActive(pathname, item)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];

  const waiting = supportSignal !== null && supportSignal.status !== "clear";

  return (
    <>
      <div className="kivo-glass-brand sticky top-0 z-30 flex items-center justify-between gap-3 rounded-none px-4 py-3 lg:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <Image src={kivoLogo} alt="" width={28} height={28} className="kivo-ink h-7 w-7 shrink-0" priority />
          <span className="truncate text-sm font-semibold tracking-tight text-foreground">
            {current ? current.label : "KIVO Admin"}
          </span>
        </div>
        <button
          ref={toggleRef}
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={
            waiting
              ? "Open admin navigation — the support queue needs attention"
              : "Open admin navigation"
          }
          // 44px. A7: the founder administers this from a phone and this is the
          // only control on the bar. It was 40.
          className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-1 text-foreground-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
          {/* The drawer is closed by definition on a phone, so the badge inside
              it is invisible until somebody already went looking. This dot is
              the part that is visible without doing anything. It is not the
              signal on its own — the banner under the bar carries the sentence. */}
          {waiting && (
            <span
              aria-hidden="true"
              className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ${
                supportSignal?.status === "open" && supportSignal.stale ? "bg-critical" : "bg-warning"
              }`}
            />
          )}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 flex lg:hidden"
          >
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-overlay backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label="Admin navigation"
              initial={{ x: -24, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -24, opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 36 }}
              className="kivo-glass-brand relative z-10 flex h-full w-[86vw] max-w-sm flex-col gap-5 overflow-y-auto rounded-l-none rounded-r-3xl p-5 pt-[calc(env(safe-area-inset-top)+20px)]"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Image src={kivoLogo} alt="" width={32} height={32} className="kivo-ink h-8 w-8 shrink-0" priority />
                  <span className="text-base font-semibold tracking-tight text-foreground">KIVO Admin</span>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close admin navigation"
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-1 text-foreground-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  <X className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </div>

              <nav aria-label="Admin" className="flex flex-col gap-5">
                {ADMIN_NAV_GROUPS.map((group) => {
                  const items = group.items.filter((item) => allowed.has(item.href));
                  if (items.length === 0) return null;
                  return (
                    <div key={group.id} className="flex flex-col">
                      <span className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                        {group.label}
                      </span>
                      <div className="flex flex-col divide-y divide-hairline-soft overflow-hidden rounded-2xl bg-surface-1">
                        {items.map((item) => {
                          const active = isAdminNavItemActive(pathname, item);
                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              onClick={() => setOpen(false)}
                              aria-current={active ? "page" : undefined}
                              className={cn(
                                "flex min-h-14 items-start gap-3 px-3 py-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60",
                                active ? "bg-surface-2" : "hover:bg-surface-2",
                              )}
                            >
                              <item.icon
                                className={cn(
                                  "mt-0.5 h-[18px] w-[18px] shrink-0",
                                  active ? "text-accent" : "text-foreground-subtle",
                                )}
                                strokeWidth={1.75}
                              />
                              <span className="flex min-w-0 flex-col gap-0.5">
                                <span
                                  className={cn(
                                    "flex items-center gap-2 text-sm font-semibold",
                                    active ? "text-accent" : "text-foreground",
                                  )}
                                >
                                  {item.label}
                                  {item.href === "/admin/support" && <SupportBadge signal={supportSignal} />}
                                </span>
                                <span className="text-[11px] leading-snug text-foreground-subtle">
                                  {item.description}
                                </span>
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </nav>

              <div className="mt-auto flex flex-col gap-3">
                <ThemeToggle className="max-w-none" />
                <div className="flex flex-col divide-y divide-hairline-soft rounded-2xl bg-surface-1">
                  <Link
                    href="/home"
                    onClick={() => setOpen(false)}
                    className="flex min-h-14 items-center px-3 text-sm font-medium text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    ← Back to KIVO
                  </Link>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
