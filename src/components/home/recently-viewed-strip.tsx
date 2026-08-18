"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "motion/react";
import { Shield, UserRound, Trophy } from "lucide-react";
import {
  getRecentlyViewed,
  getRecentlyViewedServerSnapshot,
  subscribeRecentlyViewed,
  type RecentlyViewedEntry,
} from "@/lib/recently-viewed";

const MotionLink = motion.create(Link);

const TYPE_HREF: Record<RecentlyViewedEntry["type"], string> = {
  team: "/teams",
  player: "/players",
  league: "/leagues",
};

const TYPE_ICON: Record<RecentlyViewedEntry["type"], typeof Shield> = {
  team: Shield,
  player: UserRound,
  league: Trophy,
};

/**
 * Reads localStorage, so real content only exists client-side — the server
 * has no access to it. useSyncExternalStore is the React-native fix for
 * exactly this: it renders the server snapshot (always empty) through
 * hydration to guarantee no mismatch, then swaps to the real client
 * snapshot right after. An empty list (before or after that swap) renders
 * nothing at all — never an empty "Recently viewed" section.
 */
export function RecentlyViewedStrip() {
  const entries = useSyncExternalStore(subscribeRecentlyViewed, getRecentlyViewed, getRecentlyViewedServerSnapshot);

  if (entries.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">Recently viewed</span>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {entries.map((entry, index) => {
          const Icon = TYPE_ICON[entry.type];
          return (
            <MotionLink
              key={`${entry.type}:${entry.id}`}
              href={`${TYPE_HREF[entry.type]}/${entry.id}`}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, delay: index * 0.03, ease: [0.22, 1, 0.36, 1] }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.96 }}
              className="kivo-glass-sharp flex w-24 shrink-0 flex-col items-center gap-1.5 rounded-xl p-2.5 text-center transition-colors hover:bg-surface-2"
            >
              {entry.imageUrl ? (
                <Image src={entry.imageUrl} alt="" width={32} height={32} className="h-8 w-8 shrink-0 object-contain" />
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2">
                  <Icon className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
                </div>
              )}
              <span className="w-full truncate text-[11px] font-medium text-foreground">{entry.name}</span>
            </MotionLink>
          );
        })}
      </div>
    </div>
  );
}
