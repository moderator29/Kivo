/**
 * How many rows of a long client-side list to actually put in the DOM.
 *
 * `/managers` and `/venues` fetch up to 500 rows in one go and render every one
 * of them, because both are filtered in the browser rather than on the server
 * and the filter needs the whole set in memory. Keeping 500 rows in *memory* is
 * free — a `.filter()` over 500 objects is microseconds. Keeping 500 rows in
 * the *DOM* is not. Measured against the real `ManagersList` at 500 rows, on a
 * 4x-throttled CPU (docs/PERFORMANCE.md):
 *
 *   first render   6,688 ms wall, 6,071 DOM nodes, TBT 4,005 ms,
 *                  worst single long task 1,172 ms
 *   typing 16 chars 9,719 ms wall, TBT 4,580 ms
 *
 * A 1,172 ms task is a second of a completely frozen phone, and every keystroke
 * in the filter re-rendered all 500 rows — each one a `motion.div` with
 * `layout`, which measures its own box on every render.
 *
 * So: filter over everything, render a window. This is deliberately not
 * virtualization. Windowing by scroll position would mean measuring rows,
 * synthesising scroll height and re-rendering on every frame of a scroll — a
 * lot of machinery, and a list that cannot be found with ctrl-F or read
 * linearly by a screen reader. A capped list with an explicit "Show more" is
 * the same idiom the rest of the product already uses for `/teams`, `/leagues`
 * and the feed, it keeps every rendered row real and findable, and it tells the
 * reader the truth about how many there are.
 */

/** One screen and a bit of rows: enough that the control is below the fold on
 * a phone rather than immediately in the way, small enough that the first
 * render is cheap. Matches TEAMS_PAGE_SIZE / LEAGUES_PAGE_SIZE so the product
 * reveals long lists at one rhythm. */
export const CAPPED_LIST_STEP = 60;

/**
 * The next window size after a "Show more", never past the end.
 *
 * Clamped rather than left to grow so the caller can compare `visible` against
 * `total` to decide whether the control still has anything to reveal.
 */
export function nextVisibleCount(current: number, total: number, step = CAPPED_LIST_STEP): number {
  if (!Number.isFinite(current) || current < 0) return Math.min(step, Math.max(0, total));
  return Math.min(current + step, Math.max(0, total));
}

/** Whether a "Show more" control has anything left to show. */
export function hasMoreToShow(visible: number, total: number): boolean {
  return visible < total;
}

/**
 * The label under a capped list. Says the real numbers, so nobody has to guess
 * whether they are looking at everything — and says nothing at all when they
 * are.
 */
export function cappedListStatus(visible: number, total: number): string | null {
  if (total === 0) return null;
  const shown = Math.min(Math.max(visible, 0), total);
  if (shown >= total) return null;
  return `Showing ${shown} of ${total}`;
}
