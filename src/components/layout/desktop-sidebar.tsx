"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { Search, UserRound } from "lucide-react";
import { NAV_ITEMS, isActiveRoute, type NavItem } from "@/lib/navigation";
import { buildNavGroups, NAV_GROUPS } from "@/lib/nav-groups";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { PreviewModeToggle } from "@/components/admin/preview-mode-toggle";
import { cn } from "@/lib/utils";
import type { ViewerProfileSummary } from "./app-shell";
import kivoLogo from "../../../public/brand/kivo-logo-transparent.webp";

/** Kept as a named export because other modules have imported it from here
 * since before the grouping moved to src/lib/nav-groups.ts. The array itself
 * now lives there, shared with the mobile drawer. */
export const SIDEBAR_GROUPS = NAV_GROUPS;

/**
 * The desktop sidebar — deliberately the same product as the mobile drawer,
 * not a second one.
 *
 * Both carry the identical thing in the identical order: brand, account,
 * search, the same grouped nav, and a footer holding appearance. The only
 * difference is that a 1440px screen can leave it open permanently while a
 * 390px one opens it from the top-left menu button. That is what "one product"
 * has to mean here — the same map, presented at two widths, rather than two
 * navigations that happen to reach the same routes.
 */
export function DesktopSidebar({
  aiConfigured,
  isAdmin,
  viewerProfile,
  previewMode = false,
}: {
  aiConfigured: boolean;
  isAdmin: boolean;
  viewerProfile: ViewerProfileSummary | null;
  previewMode?: boolean;
}) {
  const pathname = usePathname();
  const homeItem = NAV_ITEMS.find((item) => item.id === "home");
  const searchItem = NAV_ITEMS.find((item) => item.id === "search");
  const groups = buildNavGroups({ isAdmin });

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-hairline-soft bg-surface-3/60 px-3 py-6 lg:flex">
      <Link
        href="/home"
        className="kivo-focus flex items-center gap-2 rounded-lg px-3 pb-5"
      >
        <Image src={kivoLogo} alt="" width={36} height={36} className="kivo-ink h-9 w-9 shrink-0" priority />
        <span className="text-lg font-semibold tracking-tight text-foreground">KIVO</span>
      </Link>

      {viewerProfile && (
        <Link
          href="/profile"
          className="kivo-glass kivo-focus mb-3 flex items-center gap-2.5 rounded-2xl p-2 transition-colors hover:bg-surface-2"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-1">
            {viewerProfile.avatarUrl ? (
              <Image
                src={viewerProfile.avatarUrl}
                alt=""
                width={32}
                height={32}
                className="h-full w-full object-cover"
                unoptimized
              />
            ) : (
              <UserRound className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-foreground">
              {viewerProfile.displayName || `@${viewerProfile.username}`}
            </span>
            <span className="block truncate text-[11px] text-foreground-subtle">@{viewerProfile.username}</span>
          </span>
        </Link>
      )}

      {/* A link to /search, not a button that opens a modal — same destination
          as the drawer's field and the same one ⌘K lands on, so there is one
          search in this product rather than a desktop one and a mobile one.
          The shortcut is advertised here rather than hidden, since this is the
          surface where a keyboard is actually present. */}
      {searchItem && (
        <Link
          href={searchItem.href}
          aria-current={isActiveRoute(pathname, searchItem.href) ? "page" : undefined}
          className="kivo-glass kivo-focus mb-3 flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-foreground-subtle transition-colors hover:bg-surface-2 hover:text-foreground-muted"
        >
          <Search className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate">Search</span>
          <kbd className="shrink-0 rounded border border-hairline px-1.5 py-0.5 text-[11px] text-foreground-subtle">
            ⌘K
          </kbd>
        </Link>
      )}

      <nav className="flex flex-1 flex-col overflow-y-auto">
        {homeItem && (
          <div className="flex flex-col pb-3">
            <SidebarLink item={homeItem} pathname={pathname} aiConfigured={aiConfigured} />
          </div>
        )}
        {/* One grouped card with hairline dividers between sections instead of
            a per-row hover/active box — depth comes from the active item's
            slim accent bar + icon/text color, not a filled pill. */}
        <div className="kivo-glass flex flex-col rounded-2xl">
          {groups.map((group, index) => (
            <div key={group.label} className={cn("flex flex-col py-1.5", index > 0 && "border-t border-hairline-soft")}>
              <span className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
                {group.label}
              </span>
              {group.items.map((item) => (
                <SidebarLink key={item.id} item={item} pathname={pathname} aiConfigured={aiConfigured} />
              ))}
            </div>
          ))}
        </div>
      </nav>

      {/* Footer, mirroring the drawer's: appearance lives with the rest of the
          navigation now, not in the top bar. */}
      <div className="mt-3 flex flex-col gap-2 border-t border-hairline-soft pt-3">
        {isAdmin && <PreviewModeToggle active={previewMode} />}
        <ThemeToggle className="max-w-none" />
      </div>
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
        "kivo-focus group relative flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium transition-colors focus-visible:ring-inset",
        active ? "font-semibold text-foreground" : "text-foreground-muted hover:text-foreground",
      )}
    >
      {active && (
        <motion.span
          aria-hidden="true"
          layoutId="desktop-nav-active"
          className="kivo-gradient-prime absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-full"
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
      <span className="flex-1">{item.label}</span>
      {isComingSoon && (
        <span className="rounded-full border border-hairline px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          Soon
        </span>
      )}
    </Link>
  );
}
