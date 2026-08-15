"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { ADMIN_NAV_ITEM, NAV_ITEMS, isActiveRoute, type NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import kivoLogo from "../../../public/brand/kivo-logo.png";

/** Purely a presentation grouping for the desktop sidebar — doesn't touch
 * NAV_ITEMS or routing. "home" is rendered standalone above these as the
 * dashboard entry point; every other id must appear in exactly one group
 * below so the sidebar still surfaces the full nav set. */
const SIDEBAR_GROUPS: { label: string; ids: string[] }[] = [
  { label: "Watch", ids: ["live", "matches", "news"] },
  { label: "Play", ids: ["fantasy", "predictions"] },
  { label: "Explore", ids: ["discover", "teams", "players", "leagues", "transfers"] },
  { label: "Community", ids: ["social"] },
  { label: "You", ids: ["ai", "rewards", "settings", "profile"] },
];

export function DesktopSidebar({ aiConfigured, isAdmin }: { aiConfigured: boolean; isAdmin: boolean }) {
  const pathname = usePathname();
  const homeItem = NAV_ITEMS.find((item) => item.id === "home");
  const groups = SIDEBAR_GROUPS.map((group) => ({
    label: group.label,
    items: group.ids
      .map((id) => NAV_ITEMS.find((item) => item.id === id))
      .filter((item): item is NavItem => Boolean(item)),
  })).filter((group) => group.items.length > 0);

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-white/5 bg-kivo-navy-deep/60 px-3 py-6 lg:flex">
      <Link
        href="/home"
        className="flex items-center gap-2 rounded-lg px-3 pb-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
      >
        <Image src={kivoLogo} alt="" width={36} height={36} className="h-9 w-9 shrink-0" priority />
        <span className="text-lg font-semibold tracking-tight text-foreground">KIVO</span>
      </Link>

      <nav className="flex flex-1 flex-col overflow-y-auto">
        {homeItem && (
          <div className="flex flex-col gap-0.5 pb-3">
            <SidebarLink item={homeItem} pathname={pathname} aiConfigured={aiConfigured} />
          </div>
        )}
        {groups.map((group, index) => (
          <div key={group.label} className={cn("flex flex-col gap-0.5", index > 0 && "mt-3")}>
            <span className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
              {group.label}
            </span>
            {group.items.map((item) => (
              <SidebarLink key={item.id} item={item} pathname={pathname} aiConfigured={aiConfigured} />
            ))}
          </div>
        ))}
        {/* Item 134: no link to /admin anywhere in the app shell — shown only
            for roles hasAdminAccess() actually grants /admin to (computed
            server-side in (app)/layout.tsx), same as ADMIN_NAV_ITEM's own
            reasoning for staying out of NAV_ITEMS/SIDEBAR_GROUPS above. */}
        {isAdmin && (
          <div className="mt-3 flex flex-col gap-0.5">
            <span className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
              Admin
            </span>
            <SidebarLink item={ADMIN_NAV_ITEM} pathname={pathname} aiConfigured={aiConfigured} />
          </div>
        )}
      </nav>
    </aside>
  );
}

function SidebarLink({
  item,
  pathname,
  aiConfigured,
}: {
  item: NavItem;
  pathname: string | null;
  aiConfigured: boolean;
}) {
  const active = isActiveRoute(pathname, item.href);
  const Icon = item.icon;
  const isComingSoon = item.status === "coming-soon" && !(item.id === "ai" && aiConfigured);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60",
        active ? "text-foreground" : "text-foreground-muted hover:bg-white/[0.04] hover:text-foreground",
      )}
    >
      {active && (
        <motion.span
          aria-hidden="true"
          layoutId="desktop-nav-active"
          className="absolute inset-0 rounded-xl bg-white/[0.06]"
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
        />
      )}
      <Icon
        className={cn(
          "relative z-10 h-[18px] w-[18px] shrink-0 transition-colors",
          active ? "text-kivo-cyan" : "text-foreground-subtle group-hover:text-foreground-muted",
        )}
        strokeWidth={1.75}
      />
      <span className="relative z-10 flex-1">{item.label}</span>
      {isComingSoon && (
        <span className="relative z-10 rounded-full border border-white/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          Soon
        </span>
      )}
    </Link>
  );
}
