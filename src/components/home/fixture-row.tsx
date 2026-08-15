"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { motion } from "motion/react";

const MotionLink = motion.create(Link);

/**
 * A single row in Home's "Today" fixtures card. Client-side so each row can
 * stagger into view (offset by `index`) and lift slightly on hover, matching
 * the tactile treatment used for the stat tiles below it. Crests are rendered
 * server-side (by `TeamCrest` in the parent page) and passed in as nodes, so
 * this component stays focused on motion/interaction only.
 */
export function FixtureRow({
  href,
  homeCrest,
  homeName,
  awayCrest,
  awayName,
  scoreLabel,
  live,
  index,
}: {
  href: string;
  homeCrest: ReactNode;
  homeName: string;
  awayCrest: ReactNode;
  awayName: string;
  scoreLabel: string;
  live: boolean;
  index: number;
}) {
  return (
    <MotionLink
      href={href}
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: 0.18 + index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ x: 2 }}
      className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/5"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {homeCrest}
        <span className="truncate text-sm text-foreground">{homeName}</span>
      </div>
      <span className={`shrink-0 text-xs font-semibold ${live ? "text-live" : "text-foreground-subtle"}`}>
        {scoreLabel}
      </span>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        <span className="truncate text-right text-sm text-foreground">{awayName}</span>
        {awayCrest}
      </div>
    </MotionLink>
  );
}
