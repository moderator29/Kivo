"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV_GROUPS, isAdminNavItemActive } from "@/lib/admin-nav";
import type { SupportQueueSignal } from "@/lib/admin/support-signal";
import { SupportBadge } from "@/components/admin/support-badge";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { cn } from "@/lib/utils";
import kivoLogo from "../../../public/brand/kivo-logo-transparent.webp";

/**
 * Admin's desktop navigation.
 *
 * Previously a flat list of six links with no grouping — which was fine at six
 * and stopped being fine the moment Football data became four pages. The groups
 * are the same four the section is built around (see `src/lib/admin-nav.ts`),
 * and `permitted` is the set of hrefs this viewer's role can actually use, so a
 * moderator is not shown four football pages that answer with a lock screen. A
 * group with nothing left in it is dropped rather than rendered as a bare
 * heading.
 */

export function AdminSidebar({
  permitted,
  supportSignal,
}: {
  permitted: string[];
  supportSignal: SupportQueueSignal | null;
}) {
  const pathname = usePathname();
  const allowed = new Set(permitted);

  return (
    <aside className="hidden w-64 shrink-0 flex-col p-3 lg:flex">
      <div className="kivo-glass-brand flex h-full flex-col gap-5 rounded-3xl p-4">
        <Link
          href="/admin"
          className="kivo-focusable flex min-h-11 items-center gap-2 rounded-xl px-2"
          aria-label="KIVO Admin overview"
        >
          <Image src={kivoLogo} alt="" width={32} height={32} className="kivo-ink h-8 w-8 shrink-0" priority />
          <span className="text-base font-semibold tracking-tight text-foreground">KIVO Admin</span>
        </Link>

        <nav aria-label="Admin" className="flex flex-col gap-5">
          {ADMIN_NAV_GROUPS.map((group) => {
            const items = group.items.filter((item) => allowed.has(item.href));
            if (items.length === 0) return null;
            return (
              <div key={group.id} className="flex flex-col gap-1">
                <span className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                  {group.label}
                </span>
                {items.map((item) => {
                  const active = isAdminNavItemActive(pathname, item);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      title={item.description}
                      className={cn(
                        "kivo-focusable flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-all",
                        active
                          ? "kivo-gradient-prime text-on-accent kivo-glow-soft"
                          : "text-foreground-muted hover:bg-surface-2 hover:text-foreground",
                      )}
                    >
                      <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
                      {item.label}
                      {item.href === "/admin/support" && <SupportBadge signal={supportSignal} className="ml-auto" />}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* The design system page tells its reader to "switch the theme from
            the top bar to audit the other palette" — /admin has no top bar and
            had no theme control anywhere, so that instruction was unfollowable
            from the one page that gives it. It also happens to be the control
            an operator auditing Admin itself in both palettes needs. */}
        <div className="mt-auto flex flex-col gap-3 px-2 pb-1">
          <ThemeToggle className="max-w-none" />
          <Link
            href="/home"
            className="flex min-h-11 items-center text-xs text-foreground-subtle transition-colors hover:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            ← Back to KIVO
          </Link>
        </div>
      </div>
    </aside>
  );
}
