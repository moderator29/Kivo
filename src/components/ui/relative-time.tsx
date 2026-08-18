"use client";

import { useSyncExternalStore } from "react";
import { DISPLAY_LOCALE, formatDateTime, timeAgo, type DateTimeFormatName } from "@/lib/format";

/**
 * The two timestamp renderers for Client Components.
 *
 * The problem they solve (docs/BUG_AUDIT_2026-08-18.md C5): a Client
 * Component renders twice — once on the server into HTML, once in the browser
 * during hydration — and React compares the two. A timestamp is the one value
 * that legitimately cannot match, for two reasons the server has no way
 * around: it does not know the reader's time zone, and time passes between
 * the two renders. /social carries one of these per post *and* per comment,
 * which is why it is the densest surface for the mismatch.
 *
 * Both use `useSyncExternalStore` to separate "what the server rendered" from
 * "what is true in this browser" — the same idiom
 * src/components/theme/theme-provider.tsx already uses for the pre-paint
 * theme stamp, and the reason neither component needs to set state from an
 * effect. The hydration pass renders the server's value, React then re-renders
 * with the browser's, and nothing mismatches in between.
 *
 * Both render a real `<time dateTime={iso}>`, so the machine-readable instant
 * is in the markup whatever the text ends up saying.
 */

/** How often a mounted <RelativeTime> re-checks the clock. A minute is the
 * finest granularity `timeAgo` expresses past its "just now" band, so a
 * shorter tick would re-render for no visible change. */
const TICK_MS = 30_000;

function subscribeToClock(onStoreChange: () => void) {
  const interval = setInterval(onStoreChange, TICK_MS);
  return () => clearInterval(interval);
}

// getSnapshot must return a cached, referentially stable value or React
// re-renders forever, so this reports the *tick number* rather than the raw
// clock: it changes once per interval and is identical on every call in
// between. Its only job is to tell React the clock moved; the label itself is
// computed from the real current time at render.
let cachedTick = -1;
function getClockTick() {
  const tick = Math.floor(Date.now() / TICK_MS);
  if (tick !== cachedTick) cachedTick = tick;
  return cachedTick;
}

/** Distinct from any real tick, so a component can tell "this is the render
 * whose output has to match the server HTML" from "this is a live browser". */
const SERVER_TICK = -1;
function getServerClockTick() {
  return SERVER_TICK;
}

/**
 * A relative label ("just now", "5m", "3h") that keeps up with the clock.
 *
 * `suppressHydrationWarning` is deliberate and narrowly scoped here: a post
 * written 59 seconds before the server rendered is "just now" in the HTML and
 * "1m" by the time the browser hydrates. That difference is real, unavoidable
 * and purely cosmetic — which is exactly the case React documents the escape
 * hatch for. It covers one element whose entire text is a clock reading, it
 * does not extend to that element's children, and nothing else in the app
 * uses it except the root <html> theme stamp. The locale half of the mismatch
 * is fixed properly, at the source, in src/lib/format.ts — this is not
 * covering for that.
 *
 * The subscription is what stops the label freezing: without it "2h" stays
 * "2h" for as long as the tab is open, because nothing would ever re-render it.
 */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  useSyncExternalStore(subscribeToClock, getClockTick, getServerClockTick);

  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {timeAgo(iso)}
    </time>
  );
}

const subscribeToNothing = () => () => {};
const isHydrated = () => true;
const isServerRender = () => false;

/**
 * An absolute timestamp shown in the reader's own time zone.
 *
 * SSR and the hydration pass both format in UTC — the one zone the server can
 * pick reproducibly. Once hydrated, React re-renders with the browser's real
 * zone, which is the value the reader actually wants: a kickoff time, a
 * suspension expiry or a fantasy deadline in the server's zone is not a
 * cosmetic difference, it is the wrong time.
 *
 * `suppressHydrationWarning` covers the gap between those two renders, and it
 * is needed for a reason pinning the locale cannot fix: Node and Chromium
 * ship different ICU versions, so the *same* locale and the *same* options can
 * still disagree on punctuation. Measured, not assumed — for
 * `{ weekday, month, day, hour, minute }` in en-GB/UTC, Node renders
 * "Fri 14 Aug, 19:30" and Chromium renders "Fri, 14 Aug, 19:30". Since this
 * element's text is replaced with the reader's own zone a frame after
 * hydration regardless, the server's rendering of it is provisional by
 * design — exactly the narrow case the escape hatch exists for, scoped to one
 * element and not inherited by its children.
 */
export function LocalDateTime({
  iso,
  format,
  className,
}: {
  iso: string;
  format: DateTimeFormatName;
  className?: string;
}) {
  const hydrated = useSyncExternalStore(subscribeToNothing, isHydrated, isServerRender);

  return (
    <time dateTime={iso} className={className} lang={DISPLAY_LOCALE} suppressHydrationWarning>
      {formatDateTime(iso, format, hydrated ? undefined : "UTC")}
    </time>
  );
}
