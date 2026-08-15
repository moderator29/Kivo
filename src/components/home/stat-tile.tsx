"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

const MotionLink = motion.create(Link);

/**
 * A single Home dashboard stat tile (Fantasy / Predictions / XP). Needs to be
 * a client component because it drives hover/tap micro-interactions via
 * `motion/react` (server components can't use `whileHover`/`whileTap`), and
 * also handles its own staggered entrance so the three tiles cascade in
 * individually instead of fading in as one flat block.
 */
export function StatTile({
  href,
  icon,
  value,
  label,
  brand,
  delay,
}: {
  href: string;
  icon: ReactNode;
  value: string;
  label: string;
  brand: boolean;
  delay: number;
}) {
  return (
    <MotionLink
      href={href}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.96 }}
      className={cn(
        "flex flex-col items-center gap-1.5 rounded-xl px-3 py-4 text-center transition-colors hover:bg-white/[0.06]",
        brand ? "kivo-glass-brand" : "kivo-glass-sharp",
      )}
    >
      <span className="text-kivo-cyan">{icon}</span>
      <span className="text-lg font-semibold text-foreground">{value}</span>
      <span className="text-[11px] font-medium text-foreground-subtle">{label}</span>
    </MotionLink>
  );
}
