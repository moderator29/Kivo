"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export type XpWindow = {
  id: "7d" | "30d";
  label: string;
  /** Days in the window, for the copy under the figure. */
  days: number;
  /** XP the viewer actually earned inside the window, summed from
   * `xp_ledger` rows they own. */
  earned: number;
  /** The same length of window immediately before it. Null when KIVO cannot
   * see a full previous window — an account four days old has no previous
   * seven days, and comparing against a partial one would manufacture a
   * collapse out of a birthday. */
  previous: number | null;
};

/**
 * The profile's headline figure, and the honest version of the reference's
 * "big number with a change indicator and a timeframe selector".
 *
 * The number in that position on every screen the founder sent is money. KIVO
 * has none, and the nearest thing it has that is *earned rather than counted*
 * is XP — `xp_ledger`, one row per real award, readable only by the person who
 * earned it (`xp_ledger_select_own`).
 *
 * The lifetime total already sits in the stat rail below, so putting it here
 * again would be a bigger version of a number the page has. What the page did
 * not have is *momentum*: whether the last week was a busier one than the week
 * before. That is a genuine comparison of two real sums, and it is the only
 * change indicator on this profile that does not require inventing a baseline.
 *
 * Never a percentage. A percentage against a small base — and every base here
 * is small — turns two extra predictions into "+200%", which reads as a claim
 * about a person rather than a count of what they did.
 */
export function XpMomentum({
  windows,
  total,
}: {
  windows: XpWindow[];
  /** Lifetime XP, from `get_xp_total`. Context for the window figure, not the
   * headline itself. */
  total: number;
}) {
  const [activeId, setActiveId] = useState<XpWindow["id"]>(windows[0]?.id ?? "7d");
  const active = windows.find((window) => window.id === activeId) ?? windows[0];
  if (!active) return null;

  const delta = active.previous === null ? null : active.earned - active.previous;

  return (
    <section className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
            XP earned
          </span>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-2">
            <span className="text-3xl font-semibold tabular-nums leading-none text-foreground">
              {active.earned > 0 ? "+" : ""}
              {formatNumber(active.earned)}
            </span>
            <DeltaBadge delta={delta} days={active.days} />
          </div>
          <p className="text-xs text-foreground-muted">
            in the last {active.days} days · {formatNumber(total)} XP all-time
          </p>
        </div>

        {windows.length > 1 && (
          <div
            role="group"
            aria-label="XP timeframe"
            className="flex shrink-0 items-center gap-1 rounded-xl bg-surface-track p-1"
          >
            {windows.map((window) => (
              <button
                key={window.id}
                type="button"
                onClick={() => setActiveId(window.id)}
                aria-pressed={window.id === active.id}
                className={cn(
                  "kivo-focus rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors",
                  window.id === active.id
                    ? "bg-surface-raised text-foreground shadow-soft"
                    : "text-foreground-subtle hover:text-foreground",
                )}
              >
                {window.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {active.earned === 0 && (
        <Link
          href="/predictions"
          className="kivo-focus flex w-fit items-center gap-1 text-xs font-semibold text-accent hover:text-accent-strong"
        >
          Call a result to start earning again
          <ArrowRight className="h-3 w-3" strokeWidth={2} />
        </Link>
      )}
    </section>
  );
}

function DeltaBadge({ delta, days }: { delta: number | null; days: number }) {
  if (delta === null) {
    return (
      <span className="text-[11px] text-foreground-subtle">
        no earlier {days} days to compare
      </span>
    );
  }
  if (delta === 0) {
    return (
      <span className="flex items-center gap-1 rounded-full border border-hairline px-2 py-0.5 text-[11px] font-semibold text-foreground-subtle">
        <Minus className="h-3 w-3" strokeWidth={2} />
        Same as the {days} before
      </span>
    );
  }
  const up = delta > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        up ? "border-achievement/30 bg-achievement/10 text-achievement" : "border-hairline text-foreground-subtle",
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2} />
      {up ? "+" : "−"}
      {formatNumber(Math.abs(delta))} vs the {days} before
    </span>
  );
}
