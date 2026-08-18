"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";

// KIVO's own "reward" motion signature (RECOMMENDATIONS.md item 18/314):
// reaction-picker.tsx's own livelier spring config, reused rather than
// invented, reserved specifically for a moment that's actually earned.
const REWARD_SPRING = { type: "spring" as const, stiffness: 600, damping: 12 };

/**
 * Wraps a prediction's result badge (`resultInfo()` in
 * predictions/mine/page.tsx) with a brief glow + spring pop-in for a
 * genuinely correct result — "Pending"/"No result"/"Incorrect" render
 * exactly as before, no motion, no glow, so this stays a reward for a real
 * positive outcome rather than decoration applied to every row. Scoring is
 * admin-triggered in a batch (predictions-actions.ts), so there's no live
 * moment to animate as it happens; this instead gives the row itself real
 * weight whenever it renders showing a genuine win, using `kivo-gradient-
 * victory` — already the app's real achievement color (date-strip.tsx,
 * fantasy-builder.tsx, rewards/page.tsx, u/[username]/page.tsx) — rather
 * than a new one. A small client leaf, not the whole page: the server
 * component around it still fetches and renders everything else.
 */
export function ResultBadgeReveal({
  isCorrect,
  className,
  children,
}: {
  isCorrect: boolean;
  className: string;
  children: ReactNode;
}) {
  if (!isCorrect) {
    return <span className={`flex shrink-0 items-center gap-1 text-xs font-medium ${className}`}>{children}</span>;
  }

  return (
    <span className="relative shrink-0">
      <span aria-hidden="true" className="kivo-gradient-victory absolute -inset-2 rounded-full opacity-40 blur-md" />
      <motion.span
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={REWARD_SPRING}
        className={`relative flex items-center gap-1 text-xs font-medium ${className}`}
      >
        {children}
      </motion.span>
    </span>
  );
}
