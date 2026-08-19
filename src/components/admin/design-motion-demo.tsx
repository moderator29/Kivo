"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { RotateCcw } from "lucide-react";
import { MOTION_VOCABULARIES } from "@/lib/design-system";

const CONTENT_EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The three motion vocabularies, side by side and replayable.
 *
 * Reading item 318's prose tells you the spring constants; it does not tell
 * you whether the reward signature actually reads as *earned* next to the
 * chrome spring. Playing all three off one button does, in about two seconds,
 * which is the difference between a rule people follow and a rule people
 * argue about.
 *
 * Everything here inherits the root `<MotionConfig reducedMotion="user">`, so
 * a visitor with reduced motion enabled sees the end states without the
 * travel — which is itself worth demonstrating on this page.
 */
export function DesignMotionDemo() {
  const [run, setRun] = useState(0);

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={() => setRun((n) => n + 1)}
        className="kivo-glass-sharp kivo-focus flex min-h-11 w-fit items-center gap-2 rounded-xl px-4 text-sm font-medium text-foreground"
      >
        <RotateCcw className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        Replay all three
      </button>

      <div className="grid gap-3 sm:grid-cols-3">
        {MOTION_VOCABULARIES.map((vocabulary) => (
          <div key={vocabulary.id} className="kivo-glass flex flex-col gap-3 rounded-2xl p-4">
            <div className="flex h-24 items-center justify-center rounded-xl bg-surface-inset">
              {vocabulary.id === "content" && (
                <motion.div
                  key={`content-${run}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: CONTENT_EASE }}
                  className="kivo-glass rounded-xl px-4 py-2 text-xs font-medium text-foreground"
                >
                  Content
                </motion.div>
              )}
              {vocabulary.id === "chrome" && (
                <motion.div
                  key={`chrome-${run}`}
                  initial={{ opacity: 0, scale: 0.94, y: 6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  transition={{ type: "spring", stiffness: 450, damping: 36 }}
                  className="kivo-popover rounded-xl px-4 py-2 text-xs font-medium text-foreground"
                >
                  Chrome
                </motion.div>
              )}
              {vocabulary.id === "reward" && (
                <motion.div
                  key={`reward-${run}`}
                  initial={{ opacity: 0, scale: 0.72 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 600, damping: 12 }}
                  className="kivo-gradient-victory rounded-xl px-4 py-2 text-xs font-semibold text-on-accent"
                >
                  Earned
                </motion.div>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <h3 className="text-sm font-semibold text-foreground">{vocabulary.title}</h3>
              <code className="text-[11px] leading-relaxed text-accent">{vocabulary.spec}</code>
              <p className="text-[13px] leading-relaxed text-foreground-muted">{vocabulary.rule}</p>
              <p className="text-[11px] text-foreground-subtle">Used by: {vocabulary.usedBy}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
