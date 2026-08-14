"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { NAV_ITEMS, isActiveRoute } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import kivoLogo from "../../../public/brand/kivo-logo.png";

export function DesktopSidebar({ aiConfigured }: { aiConfigured: boolean }) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-white/5 bg-kivo-navy-deep/60 px-3 py-6 lg:flex">
      <Link href="/home" className="flex items-center gap-2 px-3 pb-8">
        <Image src={kivoLogo} alt="" width={36} height={36} className="h-9 w-9 shrink-0" priority />
        <span className="text-lg font-semibold tracking-tight text-foreground">KIVO</span>
      </Link>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const active = isActiveRoute(pathname, item.href);
          const Icon = item.icon;
          const isComingSoon = item.status === "coming-soon" && !(item.id === "ai" && aiConfigured);
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "text-foreground"
                  : "text-foreground-muted hover:bg-white/[0.04] hover:text-foreground",
              )}
            >
              {active && (
                <motion.span
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
                <span className="relative z-10 rounded-full border border-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-subtle">
                  Soon
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
