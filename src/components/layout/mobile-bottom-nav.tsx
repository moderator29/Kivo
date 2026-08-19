"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { UserRound } from "lucide-react";
import { NAV_ITEMS, isActiveRoute, type NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import type { ViewerProfileSummary } from "./app-shell";

/**
 * The four primary destinations, judged by what a matchday user reaches for:
 * live scores, browsing fixtures, the social feed, and predictions. Unchanged
 * by this pass — what changed is the fifth slot.
 */
export const BOTTOM_BAR_IDS = ["live", "matches", "social", "predictions"];

/**
 * The bottom bar: four destinations plus Profile.
 *
 * The fifth slot used to be a hamburger that opened a bottom sheet of
 * everything else. Founder's call, and the right one: the menu moved to the
 * top-left where platform convention puts it (see nav-drawer.tsx), and this
 * slot became Profile — the account, which used to be a small circular avatar
 * in the top-right corner, the single hardest place on a phone to reach.
 *
 * Nothing else was reshuffled: the same four primaries, the same layout, the
 * same single moving highlight.
 */
export function MobileBottomNav({ viewerProfile }: { viewerProfile: ViewerProfileSummary | null }) {
  const pathname = usePathname();

  const barItems = BOTTOM_BAR_IDS.map((id) => NAV_ITEMS.find((item) => item.id === id)).filter(
    (item): item is NavItem => Boolean(item),
  );
  const profileItem = NAV_ITEMS.find((item) => item.id === "profile");

  return (
    <nav
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+12px)] z-30 lg:hidden"
      aria-label="Primary"
    >
      <div className="kivo-glass-brand flex items-center justify-around gap-1 rounded-2xl p-2 shadow-float">
        {barItems.map((item) => (
          <BarTab key={item.id} href={item.href} label={item.label} active={isActiveRoute(pathname, item.href)}>
            <item.icon className="relative z-10 h-5 w-5 shrink-0" strokeWidth={1.75} />
          </BarTab>
        ))}

        {profileItem && (
          <BarTab
            href={profileItem.href}
            label={profileItem.label}
            active={isActiveRoute(pathname, profileItem.href)}
          >
            {viewerProfile?.avatarUrl ? (
              // The real avatar, at the size the top-right corner used to show
              // it — identity stays visible, it just moved to where a thumb
              // lands. The ring keeps a dark or light avatar legible against
              // the active gradient behind it.
              <span className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-hairline">
                <Image
                  src={viewerProfile.avatarUrl}
                  alt=""
                  width={20}
                  height={20}
                  className="h-full w-full object-cover"
                  unoptimized
                />
              </span>
            ) : (
              <UserRound className="relative z-10 h-5 w-5 shrink-0" strokeWidth={1.75} />
            )}
          </BarTab>
        )}
      </div>
    </nav>
  );
}

/** One tab. The label only appears on the active tab — five permanent labels
 * at 390px would each get ~60px and truncate, and the icon plus the moving
 * highlight already say where you are. */
function BarTab({
  href,
  label,
  active,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      aria-label={active ? undefined : label}
      className={cn(
        "kivo-focus relative flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[13px] font-semibold transition-all active:scale-95",
        active ? "text-on-accent" : "text-foreground-subtle hover:text-foreground-muted",
      )}
    >
      {active && (
        <motion.span
          aria-hidden="true"
          layoutId="mobile-nav-active"
          className="kivo-gradient-prime kivo-glow-soft absolute inset-0 rounded-xl"
          transition={{ type: "spring", stiffness: 500, damping: 40 }}
        />
      )}
      {children}
      {active && <span className="relative z-10 truncate">{label}</span>}
    </Link>
  );
}
