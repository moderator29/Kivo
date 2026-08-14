"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, Menu } from "lucide-react";
import { NAV_ITEMS, isActiveRoute } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/** Deliberately curated, not derived from a "primary" flag: a mobile thumb-reach
 * bar only fits four destinations plus More, and that set is a UX call, not data. */
const BOTTOM_BAR_IDS = ["home", "live", "social", "fantasy"];

export function MobileBottomNav() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const barItems = NAV_ITEMS.filter((item) => BOTTOM_BAR_IDS.includes(item.id));
  const moreItems = NAV_ITEMS.filter((item) => !BOTTOM_BAR_IDS.includes(item.id));

  useEffect(() => {
    if (!moreOpen) return;

    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMoreOpen(false);
        toggleButtonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end lg:hidden">
          <button
            aria-label="Close menu"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMoreOpen(false)}
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="More navigation"
            className="kivo-glass relative z-10 mb-[calc(env(safe-area-inset-bottom)+72px)] mx-3 rounded-2xl p-3"
          >
            <div className="grid grid-cols-4 gap-2">
              {moreItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    aria-current={isActiveRoute(pathname, item.href) ? "page" : undefined}
                    onClick={() => setMoreOpen(false)}
                    className="flex flex-col items-center gap-2 rounded-xl px-2 py-3 text-center hover:bg-white/[0.06]"
                  >
                    <Icon className="h-5 w-5 text-foreground-muted" strokeWidth={1.75} />
                    <span className="text-[11px] font-medium text-foreground-muted">{item.label}</span>
                    {item.status === "coming-soon" && (
                      <span className="text-[9px] font-semibold uppercase tracking-wide text-foreground-subtle">Soon</span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-white/5 bg-kivo-obsidian/95 backdrop-blur-lg pb-[env(safe-area-inset-bottom)] lg:hidden"
        aria-label="Primary"
      >
        {barItems.map((item) => {
          const active = isActiveRoute(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium",
                active ? "text-kivo-cyan" : "text-foreground-subtle",
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={1.75} />
              {item.label}
            </Link>
          );
        })}
        <button
          ref={toggleButtonRef}
          onClick={() => setMoreOpen((v) => !v)}
          className={cn(
            "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium",
            moreOpen ? "text-kivo-cyan" : "text-foreground-subtle",
          )}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
        >
          {moreOpen ? <X className="h-5 w-5" strokeWidth={1.75} /> : <Menu className="h-5 w-5" strokeWidth={1.75} />}
          More
        </button>
      </nav>
    </>
  );
}
