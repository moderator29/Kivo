import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Wraps a surface in a travelling iridescent edge light.
 *
 * Reserved for "this surface is working right now" — an AI turn generating, a
 * sync running, a live match ticking. It is the loudest ambient state in the
 * system, so it should never be decoration: if two beams are visible at once,
 * one of them is wrong.
 *
 * The beam is drawn on the wrapper's own border box, so the wrapper must carry
 * the same border radius as the surface inside it — pass it via `className`
 * and let the inner content inherit.
 */
export function BorderBeam({
  children,
  active = true,
  duration = 4,
  className,
}: {
  children: ReactNode;
  /**
   * When false this renders as a plain wrapper with no beam and no animation.
   * Gate on the real in-flight state rather than mounting/unmounting the
   * wrapper, so the surface inside does not remount and lose focus or
   * scroll position when the state flips.
   */
  active?: boolean;
  /** Seconds for one full lap. Slower reads calmer; below ~3s it gets busy. */
  duration?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("relative", active && "kivo-beam", className)}
      style={active ? ({ "--beam-duration": `${duration}s` } as CSSProperties) : undefined}
    >
      {/* Above both beam pseudo-elements (z-index 0 and 1 in globals.css) so
          the bloom washes the surface behind the content, never over it. */}
      <div className="relative z-[2]">{children}</div>
    </div>
  );
}
