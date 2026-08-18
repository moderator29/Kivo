"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { useFirstEntrance } from "@/lib/entrance";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Wraps a list of items in individually-staggered entrances.
 * Extracted from /teams, /leagues and /players, whose list components
 * (`TeamsGrid`, `LeaguesList`, `PlayersBrowser`) each rendered this same
 * "map items to a keyed, staggered entrance" shape independently.
 *
 * `delay` computes each item's entrance delay from its index — deliberately
 * left as a caller-supplied function rather than a fixed formula baked in
 * here, since the three original call sites tuned different step/cap
 * constants for their own list density (see RECOMMENDATIONS item 77 for the
 * capping question specifically; this component only removes the
 * boilerplate around it, not the tuning).
 *
 * `keyExtractor` supplies the stable React key per item, so on a "Load
 * more" append only the newly-added items (new keys) replay the entrance —
 * existing rows keep their prior key and don't remount.
 *
 * Built on `motion.div` with `layout` (RECOMMENDATIONS.md item 269) rather
 * than the plain CSS `<FadeIn>` this used until this pass: `layout` makes
 * Framer Motion animate a row's *position* (a FLIP transform) whenever its
 * index among its siblings changes on a re-render, not just its first
 * entrance — the same visual values as before (opacity + a 12px rise,
 * matching `kivo-fade-in`'s own keyframe) so nothing about the entrance
 * itself looks different, but a reordering list now moves instead of
 * silently jumping. `prefers-reduced-motion` is handled the same way every
 * other `motion.*` usage in the app already gets it, via the root
 * `<MotionConfig reducedMotion="user">`.
 */
export function StaggeredList<T>({
  items,
  keyExtractor,
  renderItem,
  delay,
  className,
  entranceId = "list",
}: {
  items: T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  delay: (index: number) => number;
  className?: string;
  /** Distinguishes two staggered lists rendered on the same route. */
  entranceId?: string;
}) {
  const firstEntrance = useFirstEntrance(entranceId);

  return (
    <div className={className}>
      {items.map((item, index) => (
        <motion.div
          key={keyExtractor(item, index)}
          layout
          // `initial={false}` tells motion to start at the animate state with
          // no transition — the row is simply there, which is what a revisit
          // should look like.
          initial={firstEntrance ? { opacity: 0, y: 12 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: firstEntrance ? delay(index) : 0, ease: EASE }}
        >
          {renderItem(item, index)}
        </motion.div>
      ))}
    </div>
  );
}
