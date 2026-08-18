"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { isActiveRoute } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import kivoLogo from "../../../public/brand/kivo-logo-transparent.webp";

// Previously plain hover-only links with no active-page indicator at all —
// on a 4-item nav that's a real usability gap (which of the four am I on?
// nothing said). Rebuilt on the same active-pill treatment already used by
// the main app's desktop sidebar and mobile nav, refined to the current
// glass-container tokens.
export function AdminSidebar({ items }: { items: { href: string; label: string; icon: LucideIcon }[] }) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 flex-col p-3 lg:flex">
      <div className="kivo-glass-brand flex h-full flex-col gap-6 rounded-3xl p-4">
        <div className="flex items-center gap-2 px-2 pt-1">
          <Image src={kivoLogo} alt="" width={32} height={32} className="h-8 w-8 shrink-0" priority />
          <span className="text-base font-semibold tracking-tight text-foreground">KIVO Admin</span>
        </div>
        <nav className="flex flex-col gap-1">
          {items.map((item) => {
            // The root "/admin" item is a prefix of every other admin route
            // (/admin/moderation, /admin/users, /admin/data-health), so the
            // shared isActiveRoute()'s startsWith check would double-highlight
            // it alongside whichever subpage is actually active. Root gets an
            // exact match instead; every other item keeps prefix matching.
            const active = item.href === "/admin" ? pathname === item.href : isActiveRoute(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60",
                  active
                    ? "kivo-gradient-prime text-kivo-white shadow-[0_0_16px_-2px_rgba(0,217,255,0.4)]"
                    : "text-foreground-muted hover:bg-white/[0.05] hover:text-foreground",
                )}
              >
                <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto px-2 pb-1">
          <Link
            href="/home"
            className="flex min-h-10 items-center text-xs text-foreground-subtle transition-colors hover:text-foreground-muted"
          >
            ← Back to KIVO
          </Link>
        </div>
      </div>
    </aside>
  );
}
