/**
 * The arithmetic behind KIVO's one back control.
 *
 * `router.back()` on its own is wrong, and wrong in a way that only shows up
 * for the users who matter most: somebody who opened a fixture from a shared
 * WhatsApp link, a push notification, a bookmark or a fresh tab has no KIVO
 * page behind them. `back()` there either does nothing at all or walks them
 * straight out of the product — the browser's history stack does not know
 * where KIVO starts.
 *
 * So every back control declares a fallback destination (its parent surface,
 * resolved in src/lib/route-class.ts) and only pops history when KIVO can
 * prove there is a KIVO page to pop back to. That proof is a depth counter,
 * and the whole of it is here: pure functions, no DOM, so the rule can be
 * tested rather than reasoned about. src/hooks/use-in-app-history.ts is the
 * thin browser wrapper that feeds them.
 *
 * The counter is deliberately conservative — see `nextDepth`. When it cannot
 * be sure, it under-counts, and an under-count means the control pushes to the
 * declared parent instead of popping. That lands the user one level up inside
 * KIVO. An over-count is the failure that strands somebody outside the app, so
 * every ambiguity resolves the other way.
 */

/** Per-tab storage key. Survives a reload, never leaves the tab. */
export const IN_APP_DEPTH_KEY = "kivo:nav-depth";

/**
 * How the current document came to be, as reported by
 * `PerformanceNavigationTiming.type`. Narrowed to what the rule cares about;
 * anything else (including a browser that reports nothing) is treated as a
 * fresh navigation, which is the safe direction.
 */
export type DocumentNavigationType = "navigate" | "reload" | "back_forward" | "prerender" | null;

/** A client-side route change, classified by how it reached us. */
export type RouteChangeKind = "push" | "pop";

/**
 * The depth to start this document at.
 *
 * A `navigate` load is a brand-new run: the user typed a URL, followed a link
 * from another site, opened a share, or tapped a notification. Whatever an
 * earlier run in this same tab left in storage says nothing about the history
 * sitting behind *this* entry, so it starts at zero and the first back press
 * goes to the declared parent.
 *
 * A `reload` or a `back_forward` restore lands on an entry that already
 * existed, with its stack intact behind it, so the stored count still holds.
 */
export function initialInAppDepth(
  navigationType: DocumentNavigationType,
  storedDepth: number | null,
): number {
  if (navigationType !== "reload" && navigationType !== "back_forward") return 0;
  return normaliseDepth(storedDepth);
}

/** Rejects anything that is not a real, non-negative, finite count. */
export function normaliseDepth(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

/**
 * The depth after one route change.
 *
 * A push adds an entry behind us. A pop removes one — and every `popstate` is
 * counted as a pop, including a forward press, because the two are not
 * distinguishable from the event alone. Miscounting a forward press costs one
 * unnecessary push to the parent; miscounting a back press would cost the user
 * the whole app.
 */
export function nextDepth(current: number, kind: RouteChangeKind): number {
  const depth = normaliseDepth(current);
  return kind === "pop" ? Math.max(0, depth - 1) : depth + 1;
}

/** Whether `router.back()` is guaranteed to land on another KIVO page. */
export function canPopHistory(depth: number): boolean {
  return normaliseDepth(depth) > 0;
}

/**
 * The accessible name for a back control.
 *
 * The visible text names the destination ("Matches") because that is what a
 * sighted user needs — read the label, know where pressing it goes. On its own
 * that reads to a screen reader as an ordinary link to Matches, identical to
 * every other link to Matches on the page. Naming the direction fixes that,
 * and keeps the visible text inside the accessible name, which is what WCAG
 * 2.5.3 (Label in Name) requires so a voice-control user can still say
 * "click Matches".
 */
export function backAccessibleLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "Back";
  return `Back to ${trimmed}`;
}
