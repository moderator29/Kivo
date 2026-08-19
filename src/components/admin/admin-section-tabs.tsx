"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV_GROUPS, isAdminNavItemActive } from "@/lib/admin-nav";
import { cn } from "@/lib/utils";

/**
 * Sideways movement inside a nav group, on the sizes where the sidebar is gone.
 *
 * Football data is four pages an operator moves between constantly — provider
 * says a season is refused, coverage says which competitions that empties,
 * pipeline says whether the retry ran. On a phone every one of those hops meant
 * opening a drawer, so the four pages read as four separate errands rather than
 * one screen with four views.
 *
 * `lg:hidden` on purpose: above that the sidebar already shows the group with
 * the same active state, and a second copy of the same four links is noise.
 */
export function AdminSectionTabs({ groupId }: { groupId: string }) {
  const pathname = usePathname();
  const group = ADMIN_NAV_GROUPS.find((candidate) => candidate.id === groupId);
  if (!group || group.items.length < 2) return null;

  return (
    <nav
      aria-label={`${group.label} pages`}
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden"
    >
      {group.items.map((item) => {
        const active = isAdminNavItemActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "kivo-focusable flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors",
              active
                ? "border-transparent bg-accent/15 text-accent"
                : "border-hairline text-foreground-muted hover:bg-surface-2 hover:text-foreground",
            )}
          >
            <item.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
