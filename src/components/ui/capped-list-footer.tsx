"use client";

import { cappedListStatus, hasMoreToShow } from "@/lib/capped-list";

/**
 * The control under a list that is showing a window of a larger set.
 *
 * Two things, and the first one is the point: it says how many of how many.
 * A list that quietly stops at sixty rows is indistinguishable from a list
 * that only has sixty, and this product does not let a screen imply something
 * it has not checked. When everything is on screen it renders nothing at all,
 * because "showing 12 of 12" makes a complete list look truncated.
 *
 * `aria-live="polite"` on the count: pressing the button changes how much of
 * the page exists, and a screen reader user gets no other signal that it
 * worked.
 */
export function CappedListFooter({
  visible,
  total,
  onShowMore,
  label,
}: {
  visible: number;
  total: number;
  onShowMore: () => void;
  /** What is being revealed, for the button's accessible name: "managers". */
  label: string;
}) {
  if (!hasMoreToShow(visible, total)) return null;
  const status = cappedListStatus(visible, total);

  return (
    <div className="flex flex-col items-center gap-2 pt-1">
      <p aria-live="polite" className="text-xs text-foreground-subtle">
        {status}
      </p>
      <button
        type="button"
        onClick={onShowMore}
        className="kivo-glass-sharp kivo-focus min-h-11 rounded-xl px-4 text-sm font-semibold text-foreground transition-colors duration-150 motion-reduce:transition-none"
      >
        Show more {label}
      </button>
    </div>
  );
}
