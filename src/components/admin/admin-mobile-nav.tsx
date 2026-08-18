"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Menu, X, type LucideIcon } from "lucide-react";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { isActiveRoute } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import kivoLogo from "../../../public/brand/kivo-logo-transparent.webp";

// Admin's sidebar is `hidden lg:flex` (see admin/layout.tsx) — below that
// breakpoint there was no navigation at all, just a bare page with no way to
// move between Overview/Moderation/Users/Data health short of editing the
// URL. This is the mobile-drawer counterpart, same grouped-list-with-
// dividers shape as the just-refreshed main app "More" sheet and settings
// page, and the same useFocusTrap contract every dialog in this app uses.
export function AdminMobileNav({ items }: { items: { href: string; label: string; icon: LucideIcon }[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useFocusTrap(open, panelRef, () => setOpen(false), { restoreFocusRef: toggleRef });

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <div className="kivo-glass-brand sticky top-0 z-30 flex items-center justify-between gap-3 rounded-none px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <Image src={kivoLogo} alt="" width={28} height={28} className="kivo-ink h-7 w-7 shrink-0" priority />
          <span className="text-sm font-semibold tracking-tight text-foreground">KIVO Admin</span>
        </div>
        <button
          ref={toggleRef}
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label="Open admin navigation"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-1 text-foreground-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
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
              className="kivo-glass-brand relative z-10 flex h-full w-[82vw] max-w-xs flex-col gap-6 overflow-y-auto rounded-l-none rounded-r-3xl p-5 pt-[calc(env(safe-area-inset-top)+20px)]"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Image src={kivoLogo} alt="" width={32} height={32} className="kivo-ink h-8 w-8 shrink-0" priority />
                  <span className="text-base font-semibold tracking-tight text-foreground">KIVO Admin</span>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close admin navigation"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-1 text-foreground-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  <X className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </div>

              <div className="flex flex-col">
                <span className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                  Admin
                </span>
                <nav aria-label="Admin" className="flex flex-col divide-y divide-hairline-soft rounded-2xl bg-surface-1">
                  {items.map((item) => {
                    // Same fix as admin-sidebar.tsx: the root "/admin" item is a
                    // prefix of every other admin route, so isActiveRoute()'s
                    // startsWith check would double-highlight it. Root needs an
                    // exact match instead.
                    const active = item.href === "/admin" ? pathname === item.href : isActiveRoute(pathname, item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-14 items-center gap-3 px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                          active ? "text-accent" : "text-foreground hover:text-accent",
                        )}
                      >
                        <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
                        {item.label}
                      </Link>
                    );
                  })}
                </nav>
              </div>

              <div className="mt-auto flex flex-col divide-y divide-hairline-soft rounded-2xl bg-surface-1">
                <Link
                  href="/home"
                  onClick={() => setOpen(false)}
                  className="flex min-h-14 items-center px-3 text-sm font-medium text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  ← Back to KIVO
                </Link>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
