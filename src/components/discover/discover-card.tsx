"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "motion/react";

const MotionLink = motion.create(Link);

/**
 * A single Discover surface card (Leagues / Teams / Players / Transfers).
 * Client component because it drives its own staggered entrance plus
 * hover/tap micro-interactions via `motion/react`, matching the pattern
 * already used by Home's `StatTile` (server components can't use
 * `whileHover`/`whileTap`).
 */
export function DiscoverCard({
  href,
  icon,
  label,
  count,
  countLabel,
  description,
  delay,
}: {
  href: string;
  icon: string;
  label: string;
  count: number;
  countLabel: string;
  description: string;
  delay: number;
}) {
  return (
    <MotionLink
      href={href}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      className="kivo-glass-sharp flex flex-col gap-3 rounded-2xl p-5 transition-colors hover:bg-surface-2"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, delay: delay + 0.08, ease: [0.22, 1, 0.36, 1] }}
      >
        <Image src={icon} alt="" width={48} height={48} className="h-12 w-12 object-contain" />
      </motion.div>
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">{label}</h2>
        <p className="text-sm leading-relaxed text-foreground-muted">{description}</p>
      </div>
      <motion.span
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: delay + 0.14, ease: [0.22, 1, 0.36, 1] }}
        className="text-xs font-medium text-accent"
      >
        {count.toLocaleString()} {countLabel}
      </motion.span>
    </MotionLink>
  );
}
