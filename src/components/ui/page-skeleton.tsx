import type { ReactNode } from "react";

/**
 * The container every route-level `loading.tsx` renders into.
 *
 * Two jobs, and the second one is the reason it exists as a component rather
 * than a class string.
 *
 * **It keeps the skeleton and the page the same shape.** A skeleton is a
 * promise about where things will be. Get the container wrong and the promise
 * breaks in the most visible way there is: content lands, and the whole page
 * jumps. That is worse than showing nothing, because nothing at least does not
 * lie about the layout. Three routes were doing exactly this — `/settings`,
 * `/social` and `/u/<handle>` render into `.kivo-page` (24px of top padding and
 * a 20px stack gap on a phone) while their skeletons used the older ad-hoc
 * column (32px and 24px), so every one of them dropped 8px and tightened on
 * arrival. Naming the container makes the mismatch greppable instead of
 * invisible; `src/lib/page-container.test.ts` then makes it a failing test.
 *
 * **It says "loading" out loud.** A screen of grey bars is silence to a screen
 * reader: `<div>`s with no text are announced as nothing at all, so the
 * experience of a slow route was a page that simply did not respond. Next's own
 * announcer reads the new document title on navigation and says nothing about
 * the wait. `role="status"` with an explicit name and `aria-busy` fixes that in
 * one place for every route, and the bars themselves are hidden from the
 * accessibility tree by `<Skeleton>` so they add noise to nobody.
 */
export function PageSkeleton({
  children,
  className = "kivo-page",
  /** What is loading, for assistive technology only — "Loading matches" reads
   * better than "Loading" when a screen reader user is moving fast. */
  label = "Loading",
}: {
  children: ReactNode;
  /** The container, used verbatim — deliberately not merged with a base class.
   * A skeleton has exactly one correct container (the one its page renders
   * into), and a component that silently adds its own would be the same drift
   * this exists to prevent: `/admin`'s pages sit inside the admin layout's own
   * padded `<main>` and must not gain `.kivo-page`'s width cap on top of it.
   * Defaults to `.kivo-page`, which is the right answer for every route that
   * has not opted out of it. */
  className?: string;
  label?: string;
}) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}
