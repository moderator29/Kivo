import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getTransparencyFreshness } from "@/lib/football/last-synced";
import { formatNumber, timeAgo } from "@/lib/format";
import { staggerDelay } from "@/lib/stagger";

export const metadata: Metadata = {
  title: "What KIVO knows",
  description: "Exactly how much football KIVO has on record right now, and when it was last updated.",
};

// RECOMMENDATIONS.md item 176: "a 'what KIVO knows' transparency page" — the
// same honesty rule that governs every empty state in this app (never show a
// fabricated number, always say when data is missing) applied to its own
// coverage. Every count below comes from each entity's own public-select RLS
// policy (migration 0001's "Football reference data: readable by everyone"
// block) — the same rows a guest can already read on /teams, /players, etc.
// — so this page reveals nothing that isn't already public, just totals it
// up in one place instead of admin-only Data Health.
const ENTITIES = [
  { table: "competitions" as const, label: "Competitions" },
  { table: "teams" as const, label: "Teams" },
  { table: "players" as const, label: "Players" },
  { table: "managers" as const, label: "Managers" },
  { table: "venues" as const, label: "Venues" },
  { table: "fixtures" as const, label: "Fixtures" },
  { table: "standings" as const, label: "Standings rows" },
  { table: "transfers" as const, label: "Transfers" },
];

export default async function TransparencyPage() {
  const supabase = createServerSupabaseClient();

  const [counts, freshness] = await Promise.all([
    Promise.all(ENTITIES.map((e) => supabase.from(e.table).select("id", { count: "exact", head: true }))),
    getTransparencyFreshness(),
  ]);

  const rows = ENTITIES.map((entity, index) => ({
    ...entity,
    count: counts[index].count ?? 0,
  }));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 lg:px-8">
      <FadeIn className="kivo-glass-brand flex items-center gap-4 rounded-2xl p-6">
        <div className="kivo-gradient-prime flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl">
          <ShieldCheck className="h-6 w-6 text-on-accent" strokeWidth={1.75} />
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-foreground">What KIVO knows</h1>
          <p className="text-sm text-foreground-muted">
            KIVO never invents football data. Here is exactly what it has on record right now, counted live, and
            how fresh it is.
          </p>
        </div>
      </FadeIn>

      <FadeIn delay={staggerDelay(1, 0.06)} className="kivo-glass rounded-2xl p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-foreground-subtle">On record</h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {rows.map((row) => (
            <div key={row.table} className="flex flex-col gap-1">
              <dt className="text-xs text-foreground-muted">{row.label}</dt>
              <dd className="text-2xl font-semibold text-foreground">{formatNumber(row.count)}</dd>
            </div>
          ))}
        </dl>
      </FadeIn>

      <FadeIn delay={staggerDelay(2, 0.06)} className="kivo-glass rounded-2xl p-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-foreground-subtle">Freshness</h2>
        <div className="flex flex-col gap-3 text-sm">
          {/* FRONTEND SWEEP: the request-quota readout that used to sit here
              ("Provider requests remaining today: 47") is an operations metric.
              It tells a fan nothing they can act on and everything about how
              KIVO is plumbed, and it already exists — with far more context —
              on admin Data Health, which is the reader it was written for. What
              a fan came to this page for is the two facts below: how much is
              here, and how current it is. */}
          <p className="text-foreground-muted">
            Last updated:{" "}
            <span className="font-medium text-foreground">
              {freshness.lastSyncedAt ? `${timeAgo(freshness.lastSyncedAt)} ago` : "not yet"}
            </span>
          </p>
          <p className="text-xs text-foreground-subtle">
            KIVO refreshes when a football page is opened and the data behind it is already stale, rather than
            continuously — so a match in progress can be a little behind the ground.
          </p>
        </div>
      </FadeIn>
    </div>
  );
}
