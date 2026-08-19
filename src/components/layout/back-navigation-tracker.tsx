"use client";

import { useCanGoBack } from "@/hooks/use-in-app-history";

/**
 * Counts KIVO's own navigations for a whole shell, not just for the screens
 * that happen to show a back control.
 *
 * `<BackLink>` records the page it is mounted on, but a control can only see
 * the screens it exists on. Without this, a run like
 * /home → /matches → /matches/<id> would have its first two hops uncounted —
 * neither is a focus route, so neither renders a back control — and the back
 * button on the fixture would push to Matches instead of popping to the exact
 * list position the user left.
 *
 * Mounted once per shell (the app shell, the admin layout, the marketing
 * shell) rather than in the root layout, so it sits above every route change
 * those shells contain. The counter itself is module-level and shared, so the
 * shells hand off to each other cleanly; the auth and onboarding screens have
 * no shell of their own and are covered by the back control they render.
 *
 * Renders nothing.
 */
export function BackNavigationTracker() {
  useCanGoBack();
  return null;
}
