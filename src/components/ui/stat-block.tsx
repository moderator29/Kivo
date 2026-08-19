import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One number and what it means.
 *
 * Two rules, and both are about honesty rather than layout.
 *
 * **A StatBlock renders a number KIVO actually has.** There is no `null`
 * handling here on purpose: a caller with no value must not render the block.
 * A grid of "—" is a grid of nothing dressed as data, and a "0" that means
 * "not counted" is worse than either. If a whole grid would be empty, that is
 * an `<EmptyState>`, not six dashes.
 *
 * **The label goes under the value, not over it.** A stat is read value-first
 * — the eye lands on the number and only then asks what it is — and the caps
 * label under it is what every scoreboard and every reference app does.
 */
export function StatBlock({
  label,
  /** The number, already formatted. Percentages keep their sign, times keep
   *  their unit; this component never formats, because a formatter that
   *  guessed at units is a fabricated fact. */
  value,
  /** One short line under the label: a rank, a comparison, a sample size. */
  meta,
  /**
   * `accent` marks the one stat in a group that is the point — the viewer's
   * own, the match-winning one. At most one per grid; more than one and none
   * of them reads as emphasised.
   */
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  tone?: "default" | "accent";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span
        className={cn(
          "text-xl font-semibold tabular-nums tracking-tight",
          tone === "accent" ? "text-accent" : "text-foreground",
        )}
      >
        {value}
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
        {label}
      </span>
      {meta && <span className="text-xs text-foreground-muted">{meta}</span>}
    </div>
  );
}

/**
 * The container for a row of stats. One surface, not one card per number.
 *
 * Six stats used to mean six glass cards, which is six borders and six shadows
 * around six short numbers — the densest possible version of the "everything
 * is a card" problem, and the one that reads worst because the boxes are so
 * much bigger than what is in them.
 *
 * The column count is fixed rather than `auto-fit`, because a grid that
 * reflows to five-then-two across a breakpoint puts the important stat in a
 * different place on every screen. Three across a phone, and the caller says
 * what happens on a wide one.
 */
export function StatGrid({
  children,
  /** Columns on a phone. Three is right for short numbers; two when the
   *  values are long (a scoreline, a percentage with a decimal). */
  columns = 3,
  /**
   * Drops the surface, for a grid inside a panel that already has one.
   */
  inset = false,
  className,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4;
  inset?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-x-3 gap-y-5",
        // Enumerated rather than built from a template literal: Tailwind scans
        // source text, so `grid-cols-${n}` compiles to nothing at all.
        columns === 2 && "grid-cols-2 sm:grid-cols-4",
        columns === 3 && "grid-cols-3 sm:grid-cols-6",
        columns === 4 && "grid-cols-4 sm:grid-cols-4",
        // p-5 is CONTAINER_ROLES.card, and it is visibly larger than the gap-3
        // between cells — DENSITY_RULES' "padding beats gap", which is the
        // ratio that makes a grid read as one group rather than as loose tiles.
        !inset && "kivo-glass rounded-2xl p-5",
        className,
      )}
    >
      {children}
    </div>
  );
}
