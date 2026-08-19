"use client";

import { useRef } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  /** Optional leading glyph. Keep it to a 14px icon — the rail is compact. */
  icon?: React.ReactNode;
  /** Small trailing count, e.g. a filtered result total. */
  badge?: string | number;
};

/**
 * Segmented control: a recessed rail with a pill that slides to the selected
 * option.
 *
 * This is the app's canonical single-choice switch for small option sets
 * (2–4). It is deliberately NOT a tab list — tabs own a panel below them and
 * carry `role="tablist"`/`aria-controls` wiring; this is an input that filters
 * or reshapes content that is already on screen. Use it for "Social | People"
 * style choices, not for page-level navigation.
 *
 * The tab list is `<SectionTabs>` (src/components/ui/section-tabs.tsx), and the
 * two are close enough in appearance to be merged by mistake, which is why both
 * files say so. The test is what the reader is choosing: a *place* in the page,
 * with its own panel and its own URL — that is `SectionTabs`; or a *setting*
 * applied to what is already in front of them — that is this. A radiogroup
 * announced as a tablist tells a screen reader user there are panels to move
 * between when there are none.
 *
 * Accessibility: a real `radiogroup` with roving tabindex, so the whole group
 * is one tab stop and the arrow keys move within it. That is the pattern
 * screen readers and keyboard users expect from a control that looks like
 * this, and it is why this is not simply three buttons.
 *
 * The pill is a shared-`layoutId` element, so switching slides it rather than
 * cutting. `<MotionConfig reducedMotion="user">` in the root layout downgrades
 * that to an instant swap for anyone who asked for reduced motion.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "md",
  className,
  /**
   * Distinguishes this instance's sliding pill from every other Segmented on
   * the page. Two groups sharing a layoutId would animate the pill *between*
   * them, flying across the screen — so this is required rather than
   * defaulted.
   */
  layoutId,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  size?: "sm" | "md";
  className?: string;
  layoutId: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const back = event.key === "ArrowLeft" || event.key === "ArrowUp";
    if (!forward && !back) return;
    event.preventDefault();
    const next = (index + (forward ? 1 : -1) + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("kivo-segment", className)}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "kivo-focus relative flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl font-semibold transition-colors",
              size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3.5 py-1.5 text-xs",
              selected ? "text-foreground" : "text-foreground-subtle hover:text-foreground",
            )}
          >
            {selected && (
              <motion.span
                layoutId={layoutId}
                aria-hidden="true"
                className="absolute inset-0 rounded-xl bg-surface-raised shadow-soft"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            {option.icon && <span className="relative flex items-center">{option.icon}</span>}
            <span className="relative">{option.label}</span>
            {option.badge !== undefined && (
              <span
                className={cn(
                  "relative rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums",
                  selected ? "bg-accent-soft text-accent" : "bg-surface-2 text-foreground-subtle",
                )}
              >
                {option.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
