import type { ComponentPropsWithoutRef, ReactNode } from "react";

type FadeInProps = {
  children: ReactNode;
  delay?: number;
} & Omit<ComponentPropsWithoutRef<"div">, "children">;

/**
 * First-paint entrance for above-the-fold server-rendered content, driven by
 * a plain CSS keyframe animation (`kivo-fade-in` in globals.css) instead of a
 * JS-mounted `motion.div`. The old version rendered at `opacity: 0` until
 * client hydration ran and `motion` mounted — on a slow-to-hydrate page, or
 * if the JS bundle failed outright, that left a blank above-the-fold screen
 * with a working nav. CSS animations run the instant the element paints,
 * hydrated or not, so content is never gated on JS just to become visible.
 * No `"use client"` needed either, so this is safe to use directly from
 * Server Components (see the landing page). Reserve actual `motion`/JS
 * animation for genuinely interactive cases (hover, drag, exit transitions).
 * See RECOMMENDATIONS.md item 76.
 *
 * Extra DOM/ARIA props (role, id, aria-*, onKeyDown, tabIndex, …) pass
 * straight through to the underlying div — lets call sites attach
 * tab/tabpanel semantics directly to a FadeIn wrapper instead of needing an
 * extra non-animated element just to hold them.
 */
export function FadeIn({ children, delay = 0, className = "", style, ...rest }: FadeInProps) {
  return (
    <div
      className={`kivo-fade-in ${className}`.trim()}
      style={delay ? { ...style, animationDelay: `${delay}s` } : style}
      {...rest}
    >
      {children}
    </div>
  );
}
