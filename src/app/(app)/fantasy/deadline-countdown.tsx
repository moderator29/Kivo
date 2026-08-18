"use client";

import { useEffect, useState } from "react";
import { formatDeadlineCountdown, deadlineUrgency, type DeadlineUrgency } from "./fantasy-rules";

// "soon"/"urgent" get their own color here, set directly on this leaf's own
// span, so it wins over whatever `valueClass` the parent StatTile applies
// (that one only ever flips once, at the hard `locked` cutover — see
// FantasyBuilder's `useDeadlinePassed`). "normal" and "passed" intentionally
// render with no override: "normal" inherits the parent's default color, and
// "passed" already gets `text-critical` from that same `locked` cutover.
const URGENCY_TEXT_CLASS: Partial<Record<DeadlineUrgency, string>> = {
  urgent: "text-critical",
  soon: "text-achievement",
};

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
  const urgency = deadlineUrgency(deadlineAt, now);
  return <span className={URGENCY_TEXT_CLASS[urgency]}>{formatDeadlineCountdown(deadlineAt, now)}</span>;
}
