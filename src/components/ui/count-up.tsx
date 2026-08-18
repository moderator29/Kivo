/**
 * A number counting up from zero on first paint, in pure CSS.
 *
 * KN-75's other half. `AnimatedNumber` (animated-number.tsx) handles a value
 * *changing* at runtime and is necessarily a Client Component. This handles the
 * different case both `/rewards` and `onboarding-flow.tsx` had independently
 * hand-rolled: a number that is already known at render time and should arrive
 * with a flourish because the user earned it.
 *
 * Kept as CSS rather than folded into `AnimatedNumber` on purpose — this is the
 * only version that works from a Server Component, which is what lets /rewards
 * stay a Server Component fetching its own data. Shipping a client bundle to
 * animate a number the server already knows would be a real cost for no gain.
 *
 * The technique: one keyframe per step, each resetting a CSS counter to the
 * real running value, so the animation lands exactly on `value` at 100% rather
 * than approaching it. Step count is capped so a five-figure total does not
 * generate five figures' worth of CSS.
 *
 * The true value is always in the DOM as visually-hidden text, so it is
 * correct for assistive tech, for a browser with no counter support, and for
 * anyone with reduced motion (globals.css clamps the animation to 0.01ms, which
 * lands on the final keyframe immediately).
 */
export function CountUp({
  value,
  /** Unique on the page — two instances would otherwise share one counter. */
  id,
  /** Rendered immediately before the number, in both the animated and the
   *  screen-reader copy. "+" for an award, so it reads as a gain. */
  prefix = "",
  delaySeconds = 0.25,
  durationSeconds = 1.2,
  className,
}: {
  value: number;
  id: string;
  prefix?: string;
  delaySeconds?: number;
  durationSeconds?: number;
  className?: string;
}) {
  if (value <= 0) return <span className={className}>{prefix}0</span>;

  const counterName = `kivo-count-${id}`;
  const animationName = `kivo-count-up-${id}`;
  const steps = Math.min(value, 40);
  const keyframes = Array.from({ length: steps + 1 }, (_, index) => {
    const percent = ((index / steps) * 100).toFixed(2);
    const stepValue = Math.round((value * index) / steps);
    return `${percent}% { counter-reset: ${counterName} ${stepValue}; }`;
  }).join("\n");

  return (
    <span className={className}>
      <style>{`
        @keyframes ${animationName} {
          ${keyframes}
        }
        .${animationName}::before {
          content: ${JSON.stringify(prefix)} counter(${counterName});
        }
      `}</style>
      <span
        aria-hidden="true"
        className={`${animationName} inline-block`}
        style={{
          animation: `${animationName} ${durationSeconds}s cubic-bezier(0.22, 1, 0.36, 1) ${delaySeconds}s forwards`,
        }}
      />
      <span className="sr-only">{prefix}{value}</span>
    </span>
  );
}
