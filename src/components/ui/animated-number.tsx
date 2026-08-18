"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

/**
 * KIVO's one number transition.
 *
 * KN-75. Every real count in the product — XP, prediction totals, fantasy
 * points, reaction counts, follower counts — changed with a hard swap, except
 * for two places (`/rewards` and `onboarding-flow.tsx`) that had each grown
 * their own CSS `counter-reset` count-up independently. Two implementations of
 * one idea is the definition of a missing primitive.
 *
 * The mechanism is a `requestAnimationFrame` interpolation rather than the CSS
 * counter trick those two used, for one concrete reason: `counter()` can only
 * render a bare integer, so a CSS-animated number silently loses the thousands
 * separators the rest of the app formats with. Driving the value in JS lets the
 * caller keep its own formatter, which matters the moment an XP total goes past
 * 999.
 *
 * Rules it enforces, so call sites don't have to decide:
 *  - A number that appears for the first time does NOT count up. A feed full of
 *    counters animating on mount is decoration; the brief's rule is that motion
 *    marks a change. `countUpOnMount` opts in for the genuine reward moments
 *    (the XP total on /rewards, the XP award at the end of onboarding).
 *  - `prefers-reduced-motion` jumps straight to the value. No transition, no
 *    residual movement.
 *  - The animating text is `aria-hidden` and the true value is carried in a
 *    visually-hidden sibling, so assistive tech is never read a number that is
 *    mid-interpolation and therefore wrong.
 */

const EASE_OUT = (t: number) => 1 - Math.pow(1 - t, 3);

export function AnimatedNumber({
  value,
  format = (n: number) => String(n),
  durationMs = 600,
  countUpOnMount = false,
  className,
}: {
  /** The real, current value. Never a placeholder. */
  value: number;
  /** Formatter for the displayed number — keep the call site's own. */
  format?: (value: number) => string;
  durationMs?: number;
  /** Count from zero on first paint. For earned moments only. */
  countUpOnMount?: boolean;
  className?: string;
}) {
  const [displayed, setDisplayed] = useState(() => (countUpOnMount ? 0 : value));
  const fromRef = useRef(countUpOnMount ? 0 : value);
  const frameRef = useRef<number | null>(null);
  // `motion`'s own hook rather than a hand-rolled matchMedia read: it is an
  // external-store subscription, so it is SSR-safe and updates live if the OS
  // setting changes, and it is the same source the rest of the app's motion
  // already respects through <MotionConfig reducedMotion="user">.
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;

    // Reduced motion is handled by rendering `value` directly below rather
    // than by setting state here — a synchronous setState inside an effect is
    // a cascading render, and there is nothing to schedule anyway when the
    // answer is "show the final number immediately".
    if (reducedMotion || durationMs <= 0) {
      fromRef.current = value;
      return;
    }

    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = EASE_OUT(progress);
      // Rounded rather than truncated so the last frame lands exactly on
      // `value` even when floating-point interpolation falls a hair short.
      setDisplayed(Math.round(from + (value - from) * eased));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = value;
        frameRef.current = null;
      }
    };
    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      // Whatever was on screen when this was interrupted becomes the next
      // animation's origin, so a rapid second change continues from where the
      // first one got to rather than snapping backwards.
      fromRef.current = displayed;
      frameRef.current = null;
    };
    // `displayed` is deliberately not a dependency: it changes every frame, and
    // depending on it would restart the animation on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs, reducedMotion]);

  const shown = reducedMotion || durationMs <= 0 ? value : displayed;

  return (
    <span className={className}>
      <span aria-hidden="true" className="tabular-nums">
        {format(shown)}
      </span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
