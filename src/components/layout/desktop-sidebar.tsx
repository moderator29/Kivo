"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { ADMIN_NAV_ITEM, NAV_ITEMS, isActiveRoute, type NavItem } from "@/lib/navigation";
import { useSidebarCollapsed } from "./sidebar-collapse";
import { cn } from "@/lib/utils";
import kivoLogo from "../../../public/brand/kivo-logo-transparent.webp";

/** Purely a presentation grouping for the desktop sidebar — doesn't touch
 * NAV_ITEMS or routing. "home" is rendered standalone above these as the
 * dashboard entry point; every other id must appear in exactly one group
 * below so the sidebar still surfaces the full nav set. */
export const SIDEBAR_GROUPS: { label: string; ids: string[] }[] = [
  { label: "Watch", ids: ["live", "matches", "news"] },
  { label: "Play", ids: ["fantasy", "predictions"] },
  { label: "Explore", ids: ["discover", "teams", "players", "leagues", "transfers"] },
  { label: "Community", ids: ["social"] },
  { label: "You", ids: ["ai", "rewards", "settings", "profile"] },
];

export function DesktopSidebar({ aiConfigured, isAdmin }: { aiConfigured: boolean; isAdmin: boolean }) {
  const pathname = usePathname();
  // KN-77: collapse-to-icons, so a 1280px laptop is not spending a fifth of its
  // width on navigation the user already knows.
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const homeItem = NAV_ITEMS.find((item) => item.id === "home");
  const groups = SIDEBAR_GROUPS.map((group) => ({
    label: group.label,
    items: group.ids
      .map((id) => NAV_ITEMS.find((item) => item.id === id))
      .filter((item): item is NavItem => Boolean(item)),
  })).filter((group) => group.items.length > 0);

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-hairline-soft bg-surface-3/60 py-6 lg:flex",
        // Width is the only thing that animates. Everything inside swaps
        // instantly, because cross-fading labels against a moving edge reads as
        // a rendering glitch rather than as a deliberate transition.
        "transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        collapsed ? "w-[68px] px-2" : "w-64 px-3",
      )}
    >
      <Link
        href="/home"
        aria-label="KIVO home"
        className={cn(
          "flex items-center gap-2 rounded-lg pb-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          collapsed ? "justify-center px-0" : "px-3",
        )}
      >
        <Image src={kivoLogo} alt="" width={36} height={36} className="kivo-ink h-9 w-9 shrink-0" priority />
        {!collapsed && <span className="text-lg font-semibold tracking-tight text-foreground">KIVO</span>}
      </Link>

      <nav className="flex flex-1 flex-col overflow-y-auto">
        {homeItem && (
          <div className="flex flex-col pb-3">
            <SidebarLink item={homeItem} pathname={pathname} aiConfigured={aiConfigured} collapsed={collapsed} />
          </div>
        )}
        {/* One grouped card with hairline dividers between sections (same
            pattern as the settings page's grouped list) instead of a
            per-row hover/active box — depth comes from the active item's
            slim accent bar + icon/text color, not a filled pill. */}
        <div className="kivo-glass flex flex-col rounded-2xl">
          {groups.map((group, index) => (
            <div key={group.label} className={cn("flex flex-col py-1.5", index > 0 && "border-t border-hairline-soft")}>
              {/* The group label is the one thing a collapsed rail genuinely
                  cannot show — an icon column has no room for a heading, and
                  abbreviating it would be worse than the hairline divider that
                  already separates the groups. */}
              {!collapsed && (
                <span className="px-3 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
                  {group.label}
                </span>
              )}
              {group.items.map((item) => (
                <SidebarLink
                  key={item.id}
                  item={item}
                  pathname={pathname}
                  aiConfigured={aiConfigured}
                  collapsed={collapsed}
                />
              ))}
            </div>
          ))}
          {/* Item 134: no link to /admin anywhere in the app shell — shown only
              for roles hasAdminAccess() actually grants /admin to (computed
              server-side in (app)/layout.tsx), same as ADMIN_NAV_ITEM's own
              reasoning for staying out of NAV_ITEMS/SIDEBAR_GROUPS above. */}
          {isAdmin && (
            <div className="flex flex-col border-t border-hairline-soft py-1.5">
              {!collapsed && (
                <span className="px-3 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
                  Admin
                </span>
              )}
              <SidebarLink
                item={ADMIN_NAV_ITEM}
                pathname={pathname}
                aiConfigured={aiConfigured}
                collapsed={collapsed}
              />
            </div>
          )}
        </div>
      </nav>

      <button
        type="button"
        onClick={toggleCollapsed}
        aria-pressed={collapsed}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className={cn(
          "kivo-focus mt-3 flex items-center gap-3 rounded-xl py-2.5 text-sm font-medium text-foreground-subtle transition-colors hover:text-foreground",
          collapsed ? "justify-center px-0" : "px-3.5",
        )}
      >
        {collapsed ? (
          <PanelLeftOpen className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <PanelLeftClose className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden="true" />
        )}
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  );
}

function SidebarLink({
  item,
  pathname,
  aiConfigured,
  collapsed,
}: {
  item: NavItem;
  pathname: string | null;
  aiConfigured: boolean;
  collapsed: boolean;
}) {
  const active = isActiveRoute(pathname, item.href);
  const Icon = item.icon;
  const isComingSoon = item.status === "coming-soon" && !(item.id === "ai" && aiConfigured);
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      // Collapsed, the label is gone from the accessibility tree with it, so
      // the destination has to be named some other way. `title` also gives
      // pointer users the native tooltip an icon rail needs to be usable.
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex items-center gap-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60",
        collapsed ? "justify-center px-0" : "px-3.5",
        active ? "font-semibold text-foreground" : "text-foreground-muted hover:text-foreground",
      )}
    >
      {active && (
        <motion.span
          aria-hidden="true"
          layoutId="desktop-nav-active"
          className="kivo-gradient-prime absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full"
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
        />
      )}
      <Icon
        className={cn(
          "h-[18px] w-[18px] shrink-0 transition-colors",
          active ? "text-accent" : "text-foreground-subtle group-hover:text-foreground-muted",
        )}
        strokeWidth={1.75}
      />
      {!collapsed && <span className="flex-1">{item.label}</span>}
      {!collapsed && isComingSoon && (
        <span className="rounded-full border border-hairline px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          Soon
        </span>
      )}
      {/* Collapsed, "Soon" has nowhere to go as text, so the same fact is
          carried by a dot on the icon — and still spoken, because a coming-soon
          destination behaves differently when you get there. */}
      {collapsed && isComingSoon && (
        <>
          <span
            aria-hidden="true"
            className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-foreground-subtle"
          />
          <span className="sr-only">Coming soon</span>
        </>
      )}
    </Link>
  );
}
