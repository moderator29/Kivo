import Link from "next/link";

export type ProfileStat = {
  href: string;
  value: string;
  label: string;
  /** Shown under the value when there is nothing to count yet, in place of a
   * bare zero that reads as a broken number. */
  hint?: string;
};

/**
 * The three-cell numbers rail under the identity block: XP, badges,
 * predictions.
 *
 * Deliberately one card split by hairlines rather than three separate tiles.
 * Three floating boxes was what `/profile` did before, and at 390px it spent
 * the full width of the screen on three small panels that each said one short
 * number — the "everything is a card" pattern the rebuild exists to undo. A
 * single rail says the same three facts in a third of the vertical space and
 * groups them as what they are: one summary, not three features.
 */
export function ProfileStatRail({ stats }: { stats: ProfileStat[] }) {
  return (
    <div className="kivo-glass grid grid-cols-3 divide-x divide-hairline-soft overflow-hidden rounded-2xl">
      {stats.map((stat) => (
        <Link
          key={stat.label}
          href={stat.href}
          className="kivo-focus flex flex-col items-center gap-0.5 px-2 py-3.5 text-center transition-colors hover:bg-surface-1"
        >
          <span className="text-lg font-semibold tabular-nums tracking-tight text-foreground">{stat.value}</span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">{stat.label}</span>
        </Link>
      ))}
    </div>
  );
}
