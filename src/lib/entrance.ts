"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Has this surface already played its entrance in this page load?
 *
 * KN-66. `StaggeredList` runs a cascading entrance every time it mounts, and
 * an App Router navigation mounts it fresh — so /teams → a team → back replays
 * the full stagger for a list of identical rows the user was looking at ten
 * seconds ago. The brief's rule is "motion communicates state, not
 * decoration"; a second identical entrance communicates nothing, it just
 * delays content the user already asked for twice.
 *
 * Deliberately an in-memory Set rather than the `sessionStorage` the item
 * suggests, for two reasons:
 *
 *  1. Correctness at hydration. A component reading `sessionStorage` in a
 *     `useState` initializer returns `false` on the server and possibly `true`
 *     on the client, which is a hydration mismatch on any animated style. A
 *     module-scope Set is empty on both sides of the very first render by
 *     construction, so it cannot mismatch.
 *  2. It is the more honest rule. A hard reload really is a fresh arrival and
 *     should animate; `sessionStorage` would suppress the entrance for the
 *     rest of the tab's life, including on a genuine first paint. Module
 *     memory dies with the page load, which is exactly the boundary "have you
 *     already seen this?" should follow.
 */
const played = new Set<string>();

/**
 * Returns true the first time a given surface mounts in this page load, false
 * on every remount after that. `id` distinguishes two lists on the same route.
 */
export function useFirstEntrance(id: string): boolean {
  const pathname = usePathname();
  const key = `${pathname}::${id}`;

  // Read once at mount. The initializer runs before any effect, and is not
  // affected by React re-invoking it in development because nothing is
  // recorded until the effect below runs.
  const [isFirst] = useState(() => !played.has(key));

  useEffect(() => {
    played.add(key);
  }, [key]);

  return isFirst;
}

/** Test-only: forget everything, so one test's entrance cannot suppress another's. */
export function resetEntrances() {
  played.clear();
}
