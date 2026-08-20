import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { Section } from "@/components/ui/section";
import { StatBlock, StatGrid } from "@/components/ui/stat-block";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getTransparencyFreshness } from "@/lib/football/last-updated";
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
//
// The labels are what a fan calls these things. "Standings rows" was the
// table's name, not the football's: a fan counts league positions, and nobody
// outside the database has ever called one a row.
const ENTITIES = [
  { table: "competitions" as const, label: "Competitions" },
  { table: "teams" as const, label: "Clubs" },
  { table: "players" as const, label: "Players" },
  { table: "managers" as const, label: "Managers" },
  { table: "venues" as const, label: "Stadiums" },
  { table: "fixtures" as const, label: "Matches" },
  { table: "standings" as const, label: "League positions" },
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
    // FRONTEND SWEEP: this hand-rolled `max-w-3xl … gap-8 px-4 py-8` column,
    // which is a different width, a different gutter and a different rhythm
    // from every other page in the app. `.kivo-page` is the container, and a
    // page about KIVO being straight with its reader is a poor place to be
    // subtly out of step with the rest of the product.
    <div className="kivo-page">
      <FadeIn className="kivo-glass-brand flex items-center gap-4 rounded-3xl p-6">
        <div className="kivo-gradient-prime flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl">
          <ShieldCheck className="h-6 w-6 text-on-accent" strokeWidth={1.75} />
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">What KIVO knows</h1>
          <p className="text-sm text-foreground-muted">
            KIVO never invents football data. Here is exactly what it has on record right now, counted live, and
            how fresh it is.
          </p>
        </div>
      </FadeIn>

      {/* One surface for eight numbers, not eight boxes — StatGrid is the
          primitive for exactly this, and it also brings the app's own label
          type with it rather than a `text-xs` invented here. */}
      <FadeIn delay={staggerDelay(1, 0.06)}>
        <Section title="On record">
          <StatGrid columns={2}>
            {rows.map((row) => (
              <StatBlock key={row.table} label={row.label} value={formatNumber(row.count)} />
            ))}
          </StatGrid>
        </Section>
      </FadeIn>

      <FadeIn delay={staggerDelay(2, 0.06)}>
        <Section title="Freshness">
          {/* FRONTEND SWEEP: the request-quota readout that used to sit here
              ("Provider requests remaining today: 47") is an operations metric.
              It tells a fan nothing they can act on and everything about how
              KIVO is plumbed, and it already exists — with far more context —
              on admin Data Health, which is the reader it was written for. What
              a fan came to this page for is the two facts below: how much is
              here, and how current it is. */}
          <div className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
            <p className="text-sm text-foreground-muted">
              Last updated:{" "}
              <span className="font-medium text-foreground">
                {freshness.lastUpdatedAt ? `${timeAgo(freshness.lastUpdatedAt)} ago` : "not yet"}
              </span>
            </p>
            <p className="text-xs text-foreground-subtle">
              KIVO refreshes when a football page is opened and the data behind it is already stale, rather than
              continuously — so a match in progress can be a little behind the ground.
            </p>
          </div>
        </Section>
      </FadeIn>
    </div>
  );
}
