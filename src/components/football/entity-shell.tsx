import type { ReactNode } from "react";

/**
 * The containers a KIVO entity page (a club, a player) is built out of.
 *
 * ## Why this file exists
 *
 * `/teams/[id]` and `/players/[id]` had each grown into a single 500–900 line
 * component that repeated the same four shapes over and over: a heading with
 * an icon, a glass card, a grid of little stat tiles, and a centred grey
 * sentence for "nothing here". Repeating them by hand is why they had drifted
 * — some headings were `text-sm uppercase`, some were not; some empty states
 * were a card, some were a bare paragraph; and the page could not be reasoned
 * about as a layout at all.
 *
 * Every shape here is the one `src/lib/design-system.ts` already prescribes:
 * `CONTAINER_ROLES.card` (rounded-2xl, p-5, gap-3) for a unit of content,
 * `CONTAINER_ROLES.row` for one item among many, and `DENSITY_RULES`'
 * "vertical rhythm is coarse" (gap-6 between sections, gap-3 inside one).
 * Nothing new is invented; the rules are just applied from one place.
 *
 * ## Adoption note
 *
 * A separate agent is landing `Section` / `ListSurface` / `StatBlock` /
 * `EmptyState` in `src/components/ui/`. These are deliberately the same four
 * shapes under different names so that swap is a rename, not a redesign —
 * when those land, this file's exports should be re-pointed at them and this
 * file deleted.
 */

/**
 * A titled block of a page. The heading sits OUTSIDE any card, because a
 * heading is a label for a group, not a row inside it — which is also what
 * lets a group be a bare list on one section and a card on the next without
 * the headings jumping around.
 *
 * `action` is the one control a section is allowed on its heading line (a
 * "See all", a window switcher). Anything more belongs inside the section.
 */
export function Section({
  title,
  icon,
  action,
  children,
  className = "",
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex flex-col gap-3 ${className}`}>
      <div className="flex min-h-[1.75rem] items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
          {icon}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * One surface holding many rows, hairline-divided. The container every list on
 * these two pages uses, and the reason a squad of 28 no longer reads as 28
 * stacked boxes — `DENSITY_RULES`, "one divider weight per boundary".
 */
export function ListSurface({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`kivo-glass overflow-hidden rounded-2xl ${className}`}>
      <ul className="flex flex-col divide-y divide-hairline-soft">{children}</ul>
    </div>
  );
}

/**
 * "There is nothing here yet", in football's own words.
 *
 * The single most important component on these two pages today, because the
 * database behind them is mostly empty and this is therefore what most readers
 * actually see. The rules it enforces by having one implementation:
 *
 *  - It never explains KIVO. No pipeline, no coverage strategy, no invitation
 *    to go and read about either. A fan looking for a squad list did not ask
 *    how the squad list gets there.
 *  - It uses football's vocabulary for absence — a club "has no squad listed",
 *    a player "has not appeared in a match KIVO covers" — never a system's.
 *  - It is quiet. One icon, one line, an optional way onward. It is not a
 *    full-height apology in the middle of a page that has other real content
 *    above and below it.
 */
export function SectionEmpty({
  icon,
  message,
  action,
  className = "",
}: {
  icon?: ReactNode;
  message: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2.5 rounded-2xl border border-dashed border-hairline px-5 py-8 text-center ${className}`}
    >
      {icon && <span className="text-foreground-subtle">{icon}</span>}
      <p className="max-w-[32ch] text-sm leading-relaxed text-foreground-muted">{message}</p>
      {action}
    </div>
  );
}

/**
 * One number and what it is. The atom every stat grid on both pages is built
 * from, so a goal count on a club page and a goal count on a player page are
 * the same object at the same size.
 *
 * `value` is a string on purpose. Formatting — a dash for "not reported", a
 * thousands separator, one decimal place on a rating — is a decision the
 * caller has the context to make and this component does not. It will not turn
 * a null into a zero, because it never sees the null.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "accent";
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-0.5 rounded-xl bg-surface-2 px-2 py-3 text-center">
      <span
        className={`text-lg font-semibold tabular-nums leading-tight ${
          tone === "accent" ? "text-accent" : "text-foreground"
        }`}
      >
        {value}
      </span>
      <span className="text-[10px] font-medium uppercase tracking-[0.06em] leading-tight text-foreground-subtle">
        {label}
      </span>
      {hint && <span className="text-[10px] leading-tight text-foreground-subtle">{hint}</span>}
    </div>
  );
}

/**
 * A labelled proportion — "shots on target, 41%", "duels won, 12 of 21".
 *
 * The bar is the only chart primitive on these pages that is allowed to render
 * without a caveat, because it draws a ratio of two real counted numbers and
 * nothing else. It takes `value` and `max` rather than a percentage so it
 * cannot be handed a figure whose denominator has been lost; a caller with no
 * real denominator has no bar to draw.
 */
export function MetricBar({
  label,
  value,
  max,
  display,
  tone = "accent",
}: {
  label: string;
  value: number;
  max: number;
  /** What to print on the right. Defaults to `value` of `max`. */
  display?: string;
  tone?: "accent" | "muted";
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-xs text-foreground-muted">{label}</span>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">
          {display ?? `${value} of ${max}`}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-track">
        <div
          className={`h-full rounded-full ${tone === "accent" ? "kivo-gradient-prime" : "bg-foreground-subtle/40"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * A pair of facts on one line — "Nationality · Spain". Used by both identity
 * blocks. Renders nothing when the value is missing rather than printing a
 * placeholder, so an unknown fact costs a line rather than becoming one.
 */
export function FactRow({ icon, label, value }: { icon?: ReactNode; label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      {icon && <span className="shrink-0 text-accent">{icon}</span>}
      <span className="shrink-0 text-foreground-subtle">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-foreground">{value}</span>
    </div>
  );
}
