"use client";

import { useSyncExternalStore } from "react";
import { matchRoomWindow, type MatchRoomWindow } from "@/lib/match-room-window";
import type { FixtureStatus } from "@/lib/football/fixture-status";

/**
 * The Match Room's open/closed state, kept current while the tab sits open.
 *
 * Two things have to be true at once here, and doing only one of them is the
 * trap:
 *
 *   1. The first client render must produce exactly what the server rendered,
 *      or React tears down and re-renders the tree with a hydration error. The
 *      Room is not a line of clock text that `suppressHydrationWarning` can
 *      paper over (see <RelativeTime>) — the difference between an open and a
 *      closed window is whether the composer exists at all, which is
 *      structural.
 *   2. It must not freeze. A fan who opens a fixture page ninety minutes
 *      before kickoff and leaves it open should watch the Room cross into the
 *      match, not sit on "not started yet" until they reload.
 *
 * So the server's verdict is passed in and used verbatim for the hydration
 * render, and only after that does this switch to the browser's own clock —
 * the same "provisional on the server, real once hydrated" shape
 * <LocalDateTime> uses for time zones. Nothing is computed from an effect, and
 * there is no window where the two renders can disagree.
 */

/** How often a mounted Room re-checks whether it is still open. The window's
 * two boundaries are a kickoff and a close 24 hours later; being up to half a
 * minute late to either is invisible, and re-deriving more often would burn a
 * render on a phone for no change. */
const TICK_MS = 30_000;

function subscribeToClock(onStoreChange: () => void) {
  const interval = setInterval(onStoreChange, TICK_MS);
  return () => clearInterval(interval);
}

// Referentially stable between ticks, for the reason <RelativeTime> documents:
// getSnapshot returning a fresh value every call re-renders forever. The tick
// number only says "the clock moved" — the window itself is derived from the
// real clock at render.
let cachedTick = -1;
function getClockTick(): number {
  const tick = Math.floor(Date.now() / TICK_MS);
  if (tick !== cachedTick) cachedTick = tick;
  return cachedTick;
}

/** Distinct from every real tick, so this render knows it is either the
 * server's or the hydration pass that has to match it. */
const SERVER_TICK = -1;
function getServerClockTick(): number {
  return SERVER_TICK;
}

export function useMatchRoomWindow(
  kickoffAt: string,
  status: FixtureStatus,
  /** What the server decided when it rendered this page. Used as-is until the
   * browser has hydrated. */
  serverWindow: MatchRoomWindow,
): MatchRoomWindow {
  const tick = useSyncExternalStore(subscribeToClock, getClockTick, getServerClockTick);
  if (tick === SERVER_TICK) return serverWindow;
  return matchRoomWindow(kickoffAt, status);
}
