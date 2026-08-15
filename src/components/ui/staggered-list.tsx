"use client";

import type { ReactNode } from "react";
import { FadeIn } from "@/components/ui/fade-in";

/**
 * Wraps a list of items in individually-staggered `FadeIn` entrances.
 * Extracted from /teams, /leagues and /players, whose list components
 * (`TeamsGrid`, `LeaguesList`, `PlayersBrowser`) each rendered this same
 * "map items to a keyed, staggered FadeIn" shape independently.
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
 */
export function StaggeredList<T>({
  items,
  keyExtractor,
  renderItem,
  delay,
  className,
}: {
  items: T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  delay: (index: number) => number;
  className?: string;
}) {
  return (
    <div className={className}>
      {items.map((item, index) => (
        <FadeIn key={keyExtractor(item, index)} delay={delay(index)}>
          {renderItem(item, index)}
        </FadeIn>
      ))}
    </div>
  );
}
