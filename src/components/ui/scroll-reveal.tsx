"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Scroll-triggered counterpart to <FadeIn> (fade-in.tsx). FadeIn fires once,
 * on first paint, via a plain CSS keyframe — correct for above-the-fold
 * content (see that file's own doc comment and RECOMMENDATIONS.md item 76),
 * wrong for anything below the fold: a CSS animation with no scroll trigger
 * has usually already finished playing, off-screen, by the time a visitor
 * actually scrolls to it, so it reads as "just appeared with the rest of the
 * DOM" rather than as a reveal tied to scrolling.
 *
 * Built on `motion` (already a dependency — FeatureCard, AiTeaser, and the
 * onboarding carousel all already use it) via `whileInView` rather than a
 * hand-rolled IntersectionObserver, so `prefers-reduced-motion` is handled
 * for free through the app-wide `<MotionConfig reducedMotion="user">` in
 * src/app/layout.tsx — the same mechanism every other `motion.*` usage in
 * the app already relies on, nothing new to wire up.
 *
 * `"use client"` is scoped to this one small leaf, not the page around it —
 * the exact lesson RECOMMENDATIONS.md item 76 already documents (the
 * landing page used to be `"use client"` in full just so two elements could
 * float via `motion.div`, which shipped the whole page tree as client JS).
 * Server-rendered children pass straight through as `children`, so any page
 * composing this stays a Server Component itself.
 *
 * `once: true` and the `-80px` viewport margin match FeatureCard's existing
 * proof-point cards exactly, so scrolling down a page that uses both reads
 * as one consistent motion language rather than two competing ones, and
 * content never re-hides itself if a visitor scrolls back up past it — a
 * premium product staying calm, not re-triggering on every pass.
 */
export function ScrollReveal({
  children,
  delay = 0,
  y = 16,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
