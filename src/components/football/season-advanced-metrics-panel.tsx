import { ChevronDown } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getActiveProviderStatus } from "@/lib/football";
import {
  buildAdvancedMetricGroups,
  type AdvancedMetricGroup,
  type SeasonStatisticsRow,
} from "@/lib/football/season-advanced-metrics";

/**
 * The other twenty-four columns.
 *
 * `player_season_statistics` stores twenty-eight stat-bearing columns per
 * player, per competition, per season. `PlayerSeasonStatisticsPanel` renders
 * four of them as the headline table, which is the right thing for it to do.
 * The remaining shots, passes, dribbles, duels, tackles, cards and saves were
 * synced, refreshed on every run, and read by nothing at all. This shows them,
 * behind a disclosure so the headline stays a headline.
 *
 * No new provider call, no new column, no quota: the same rows, displayed.
 *
 * ## Why it runs its own query
 *
 * The rows here are the same rows the headline panel already fetched, and
 * reading them twice is genuinely wasteful. It is deliberate: that panel is
 * owned by another agent working in it concurrently, and widening its `select`
 * to feed this component would have put two writers in one statement. A second
 * indexed read on `player_id` is the cheaper of the two costs. If both land in
 * one pair of hands later, threading the rows through as a prop is the obvious
 * simplification and the only change needed.
 *
 * ## What it will not do
 *
 * It will not total anything. The headline table shows an all-competitions row
 * because it can prove the provider covered every competition for that column;
 * down here the columns have wildly different coverage — a provider that
 * reports duels for a league and not for a cup is normal — so a "duels" total
 * and a "tackles" total would routinely span different competitions while
 * sitting in the same row. Both numbers true, the pair false. Every figure
 * below belongs to exactly one competition and is rendered under its name.
 */

export type AdvancedMetricsCompetition = {
  id: string;
  competitionName: string | null;
  teamName: string | null;
  groups: AdvancedMetricGroup[];
};

export type AdvancedMetricsSeason = {
  seasonYear: number;
  competitions: AdvancedMetricsCompetition[];
};

/**
 * The presentation, with no data access of its own.
 *
 * Split from the query above it so the markup can be rendered and looked at
 * against fabricated rows without a database, a provider key, or a signed-in
 * session — the same reason `share-cards/build.ts` is separate from
 * `share-cards/load.ts`. Every colour here is a KIVO token rather than a fixed
 * hex, so the disclosure follows the viewer's theme rather than assuming dark.
 */
export function AdvancedMetricsDisclosure({
  providerLabel,
  seasons,
}: {
  providerLabel: string | null;
  seasons: AdvancedMetricsSeason[];
}) {
  if (seasons.length === 0) return null;

  return (
    <details className="group rounded-2xl border border-hairline-soft p-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-foreground-muted">
        Advanced metrics
        <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" strokeWidth={2} />
      </summary>

      <p className="mt-2 text-[11px] leading-relaxed text-foreground-subtle">
        Everything else {providerLabel ?? "the connected data source"} reported for this player, per competition.
        Nothing here is added together — a metric it reports for one competition and not another would make a total
        that covers less than the figure beside it. A metric it didn&apos;t report is absent rather than shown as
        zero.
      </p>

      <div className="mt-4 flex flex-col gap-5">
        {seasons.map((season) => (
          <div key={season.seasonYear} className="flex flex-col gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
              {/* Same season convention as the table above: the provider names
                  a season by its starting year. */}
              {season.seasonYear}/{String((season.seasonYear + 1) % 100).padStart(2, "0")}
            </span>

            {season.competitions.map((competition) => (
              <div key={competition.id} className="flex flex-col gap-2 rounded-xl bg-surface-1 p-3">
                <div className="flex flex-col">
                  <span className="text-xs font-semibold text-foreground">
                    {competition.competitionName ?? "Competition"}
                  </span>
                  {competition.teamName && (
                    <span className="text-[11px] text-foreground-subtle">{competition.teamName}</span>
                  )}
                </div>

                {/* One column on a phone, two from the `sm` breakpoint up —
                    these are label/value pairs, and squeezing two of them
                    across a 360px screen is how a stat table becomes
                    unreadable. */}
                <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  {competition.groups.map((group) => (
                    <div key={group.title} className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground-subtle">
                        {group.title}
                      </span>
                      <dl className="flex flex-col">
                        {group.metrics.map((entry) => (
                          <div
                            key={entry.label}
                            className="flex items-baseline justify-between gap-3 border-b border-hairline-soft py-1 last:border-b-0"
                          >
                            <dt className="text-[11px] text-foreground-muted">{entry.label}</dt>
                            <dd className="text-xs font-semibold tabular-nums text-foreground">{entry.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}

export async function PlayerSeasonAdvancedMetrics({ playerId }: { playerId: string }) {
  const supabase = createServerSupabaseClient();
  const { label: providerLabel } = getActiveProviderStatus();

  const { data: rows } = await supabase
    .from("player_season_statistics")
    .select(
      "id, season_year, competition_name, team_name, appearances, lineups, position, provider_rating, shots_total, shots_on_target, penalties_scored, penalties_missed, passes_total, passes_key, pass_accuracy, dribbles_attempted, dribbles_succeeded, duels_total, duels_won, tackles_total, interceptions, blocks, fouls_committed, fouls_drawn, yellow_cards, red_cards, saves, goals_conceded",
    )
    .eq("player_id", playerId)
    .order("season_year", { ascending: false })
    .order("appearances", { ascending: false, nullsFirst: false })
    .limit(40);

  if (!rows || rows.length === 0) return null;

  // Only rows that actually have something beyond the headline four. A season
  // where the provider reported appearances and nothing else contributes
  // nothing here, and contributes no empty heading either.
  const withMetrics = rows
    .map((row) => ({
      id: row.id,
      seasonYear: row.season_year,
      competitionName: row.competition_name,
      teamName: row.team_name,
      groups: buildAdvancedMetricGroups(row as SeasonStatisticsRow),
    }))
    .filter((row) => row.groups.length > 0);

  // A disclosure that opens onto nothing is worse than no disclosure.
  if (withMetrics.length === 0) return null;

  const bySeason = new Map<number, AdvancedMetricsCompetition[]>();
  for (const row of withMetrics) {
    const list = bySeason.get(row.seasonYear);
    const competition: AdvancedMetricsCompetition = {
      id: row.id,
      competitionName: row.competitionName,
      teamName: row.teamName,
      groups: row.groups,
    };
    if (list) list.push(competition);
    else bySeason.set(row.seasonYear, [competition]);
  }

  return (
    <AdvancedMetricsDisclosure
      providerLabel={providerLabel}
      seasons={Array.from(bySeason.entries()).map(([seasonYear, competitions]) => ({ seasonYear, competitions }))}
    />
  );
}
