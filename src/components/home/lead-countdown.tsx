"use client";

import { useSyncExternalStore } from "react";
import { formatDurationUntil } from "@/lib/format";

/**
 * The ticking half of /home's lead card (KN-37) — a leaf client component, so
 * a countdown to kickoff or to a fantasy deadline stays honest while the tab
 * sits open without the whole server-rendered page having to become a client
 * component to achieve it. Same 30s cadence as fantasy's <DeadlineCountdown>;
 * the shared d/h/m formatting lives in src/lib/format.ts so the two clocks can
 * never disagree about what "1h 30m" means.
 *
 * The `useSyncExternalStore` shape (rather than a `useState` + `useEffect`
 * timer) is the idiom src/components/ui/relative-time.tsx already established
 * here: the label is derived at render from the real clock, and the store's
 * only job is to tell React that the clock moved. Nothing sets state from an
 * effect body.
 *
 * `passedLabel` belongs to the caller, because "the moment has arrived" reads
 * differently per surface: a kickoff is under way, a deadline is closed.
 *
 * `suppressHydrationWarning` is here for exactly the reason <RelativeTime>
 * documents — this element's entire text is a clock reading, and real time
 * passes between the server render and hydration, so "3h 12m" can legitimately
 * have become "3h 11m" in between. One span of pure clock text, nothing nested.
 */

const TICK_MS = 30_000;

function subscribeToClock(onStoreChange: () => void) {
  const interval = setInterval(onStoreChange, TICK_MS);
  return () => clearInterval(interval);
}

let cachedTick = -1;
function getClockTick() {
  const tick = Math.floor(new Date().getTime() / TICK_MS);
  if (tick !== cachedTick) cachedTick = tick;
  return cachedTick;
}

const SERVER_TICK = -1;
function getServerClockTick() {
  return SERVER_TICK;
}

export function LeadCountdown({
  iso,
  passedLabel,
  className,
}: {
  iso: string;
  passedLabel: string;
  className?: string;
}) {
  useSyncExternalStore(subscribeToClock, getClockTick, getServerClockTick);

  return (
    <span className={className} suppressHydrationWarning>
      {formatDurationUntil(iso) ?? passedLabel}
    </span>
  );
}
