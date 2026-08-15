"use client";

import { useEffect, useState } from "react";
import { formatDeadlineCountdown } from "./fantasy-rules";

/**
 * Leaf-only ticking clock for the gameweek deadline string (RECOMMENDATIONS
 * item 83). Owns its own 30s interval and re-renders only itself, instead of
 * FantasyBuilder holding the interval and re-rendering its entire tree every
 * 30 seconds just to refresh this one countdown string.
 */
export function DeadlineCountdown({ deadlineAt }: { deadlineAt: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return <>{formatDeadlineCountdown(deadlineAt, now)}</>;
}
