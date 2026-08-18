"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/** The element a route change hands focus to. Also the skip link's target. */
export const MAIN_CONTENT_ID = "main-content";

/**
 * Moves keyboard focus to <main> after a client-side route change.
 *
 * KN-78, with one correction to the item as written. It asks for two things:
 * move focus, and announce the new title in a live region. The second is
 * already done — Next 16 mounts `AppRouterAnnouncer`
 * (node_modules/next/dist/client/components/app-router-announcer.js), which
 * portals the new `document.title` into an `aria-live="assertive"` region in a
 * shadow root on every navigation. Adding a second announcer would make every
 * navigation speak twice, which is worse than the bug.
 *
 * What Next does *not* do is move focus, and that is the half that actually
 * strands a keyboard user: after navigating, the next Tab continues from
 * wherever the old page's focus was — typically a nav link, so the user tabs
 * through the entire sidebar again to reach content they already navigated to.
 *
 * `preventScroll` matters here: without it the browser scrolls the focused
 * element into view, which fights Next's own scroll restoration and can land a
 * back-navigation at the top of a page the user had scrolled halfway down.
 *
 * Skipped on first paint, where the browser's own document focus is already
 * correct and stealing it would interrupt a screen reader mid-announcement.
 *
 * The guard is the *previous pathname*, not a "have I rendered yet" flag. A
 * boolean ref does not survive React's development double-invocation of
 * effects: the first pass flips it, the second pass sees it already flipped
 * and steals focus on initial load — which, verified in Chromium, moved the
 * first Tab stop off the skip link and into the page body. Comparing paths is
 * idempotent, so running the effect twice for one navigation is harmless.
 */
export function RouteFocus() {
  const pathname = usePathname();
  const previousPath = useRef<string | null>(null);

  useEffect(() => {
    if (previousPath.current === null || previousPath.current === pathname) {
      previousPath.current = pathname;
      return;
    }
    previousPath.current = pathname;
    const main = document.getElementById(MAIN_CONTENT_ID);
    main?.focus({ preventScroll: true });
  }, [pathname]);

  return null;
}

/**
 * The one control that lets a keyboard user get past the nav. Visually hidden
 * until focused, which is the standard pattern — it is not a design element,
 * it is an escape hatch that only exists for the person who needs it.
 */
export function SkipToContent() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      // Centred rather than pinned to the top-left corner: the menu button now
      // lives there (nav-drawer.tsx), and a focused skip link sitting on top of
      // it covered the one control a keyboard user reaches next — verified in
      // Playwright, where the link genuinely intercepted clicks on the menu.
      className="kivo-popover kivo-focus sr-only rounded-xl px-4 py-2 text-sm font-semibold text-foreground focus:not-sr-only focus:absolute focus:left-1/2 focus:top-3 focus:z-50 focus:-translate-x-1/2"
    >
      Skip to content
    </a>
  );
}
