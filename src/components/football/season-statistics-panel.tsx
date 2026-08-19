import Link from "next/link";
import { ChartColumn } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getActiveProviderStatus } from "@/lib/football";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { InlineSyncButton } from "@/components/admin/inline-sync-button";
import { triggerPlayerSeasonStatisticsSync } from "@/app/admin/data-health/provider-data-actions";

/**
 * A player's season output, split by competition.
 *
 * ## Why the split is the feature
 *
 * "14 goals" and "11 in the league, 3 in the cup" are different statements
 * about a player, and only the second one can be reasoned with. The provider
 * reports per competition, the table stores per competition, and this renders
 * per competition — nothing in that chain sums, because summing is
 * irreversible and the split cannot be recovered from a total.
 *
 * A total IS shown, at the bottom, computed from the rows on screen. That is a
 * different thing from storing a total: the reader can see every number it came
 * from, and a competition missing from the list is visibly missing from the sum.
 *
 * ## Null is not zero, anywhere on this panel
 *
 * A dash means the provider did not report it. A zero means it happened zero
 * times. A goalkeeper's `tackles` and an outfielder's `saves` are routinely
 * null, and rendering either as 0 would turn "KIVO does not know" into a claim
 * about the player.
 */

type StatColumn = {
  key: "appearances" | "minutes_played" | "goals" | "assists";
  label: string;
  short: string;
};

const COLUMNS: StatColumn[] = [
  { key: "appearances", label: "Appearances", short: "Apps" },
  { key: "minutes_played", label: "Minutes played", short: "Mins" },
  { key: "goals", label: "Goals", short: "G" },
  { key: "assists", label: "Assists", short: "A" },
];

/** A dash, not a zero. See this module's doc comment. */
function statCell(value: number | null): string {
  return value === null ? "–" : value.toLocaleString("en-GB");
}

/** "goals", "goals and assists", "goals, assists and minutes played". */
function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export async function PlayerSeasonStatisticsPanel({ playerId }: { playerId: string }) {
  const supabase = createServerSupabaseClient();
  const { label: providerLabel } = getActiveProviderStatus();

  const { data: rows } = await supabase
    .from("player_season_statistics")
    .select(
      "id, season_year, competition_id, competition_name, appearances, minutes_played, goals, assists, provider_rating, team_name, retrieved_at",
    )
    .eq("player_id", playerId)
    .order("season_year", { ascending: false })
    .order("appearances", { ascending: false, nullsFirst: false })
    .limit(40);

  if (!rows || rows.length === 0) {
    // Rendered as nothing rather than as an empty card. The player page already
    // carries a real, computed match log built from KIVO's own fixtures; a
    // second empty panel next to it would say the same nothing twice.
    //
    // The one exception is an admin, who otherwise has no way to trigger the
    // first sync — a section that only appears once it has data can never be
    // made to have data.
    const adminProfile = await getOrCreateProfile();
    if (!adminProfile || !canManageFootballData(adminProfile.role)) return null;

    return (
      <FadeIn delay={0.24} className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <ChartColumn className="h-4 w-4 text-accent" strokeWidth={1.75} />
          By competition
        </h2>
        <p className="text-sm text-foreground-muted">
          No season statistics synced for this player yet. Only you can see this section.
        </p>
        <InlineSyncButton
          label="Sync season statistics"
          action={triggerPlayerSeasonStatisticsSync.bind(null, playerId, undefined)}
          hint="Requires this player's squad to have been synced first."
        />
      </FadeIn>
    );
  }

  // Grouped by season, newest first, preserving the per-competition rows within.
  const bySeason = new Map<number, typeof rows>();
  for (const row of rows) {
    const list = bySeason.get(row.season_year);
    if (list) list.push(row);
    else bySeason.set(row.season_year, [row]);
  }

  const anyUnlinked = rows.some((row) => row.competition_id === null);

  const profile = await getOrCreateProfile();
  const canSync = profile !== null && canManageFootballData(profile.role);

  return (
    <FadeIn delay={0.24} className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <ChartColumn className="h-4 w-4 text-accent" strokeWidth={1.75} />
          By competition
        </h2>
        <p className="text-[11px] text-foreground-subtle">
          Reported by {providerLabel ?? "the connected data source"}, per competition. A dash means it wasn&apos;t
          reported — not that it was zero.
        </p>
      </div>

      {Array.from(bySeason.entries()).map(([seasonYear, seasonRows]) => {
        // Summed from exactly the rows above it, so a competition the provider
        // did not report is visibly absent from both the list and the total.
        //
        // Each column used to drop its own nulls and sum whatever was left,
        // independently of every other column. So a player with three
        // competitions, one of which never reported assists, got an
        // appearances total spanning three and an assists total spanning two —
        // sitting side by side in one row labelled "All competitions", with
        // nothing saying they covered different things. Two true numbers
        // forming one false pair, which is the same error as inventing a
        // number and harder to catch, because both halves are real.
        //
        // A total is now only shown when the provider reported that column for
        // EVERY competition in the season. Anything narrower renders the same
        // dash a missing value gets, and the note below the table names which
        // columns were withheld and why — so the reader learns the coverage is
        // partial rather than silently reading a total as complete.
        const partialColumns: string[] = [];
        const totals = COLUMNS.map((column) => {
          const values = seasonRows.map((row) => row[column.key]);
          if (values.some((value) => value === null)) {
            if (values.some((value) => value !== null)) partialColumns.push(column.label.toLowerCase());
            return null;
          }
          return values.reduce((sum: number, value) => sum + (value ?? 0), 0);
        });

        return (
          <div key={seasonYear} className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
              {/* The provider identifies a season by its starting year, so
                  2025 is the 2025/26 season. Rendered as the span a fan reads. */}
              {seasonYear}/{String((seasonYear + 1) % 100).padStart(2, "0")}
            </span>

            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[380px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-hairline-soft">
                    <th scope="col" className="py-1.5 pr-2 text-left text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">
                      Competition
                    </th>
                    {COLUMNS.map((column) => (
                      <th
                        key={column.key}
                        scope="col"
                        title={column.label}
                        className="py-1.5 pl-2 text-right text-[11px] font-medium uppercase tracking-wide text-foreground-subtle"
                      >
                        {column.short}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {seasonRows.map((row) => (
                    <tr key={row.id} className="border-b border-hairline-soft last:border-b-0">
                      <td className="py-2 pr-2">
                        {row.competition_id ? (
                          <Link href={`/leagues/${row.competition_id}`} className="text-foreground hover:text-accent">
                            {row.competition_name ?? "Competition"}
                          </Link>
                        ) : (
                          <span className="text-foreground">{row.competition_name ?? "Competition"}</span>
                        )}
                        {row.team_name && (
                          <span className="block text-[11px] text-foreground-subtle">{row.team_name}</span>
                        )}
                      </td>
                      {COLUMNS.map((column) => (
                        <td key={column.key} className="py-2 pl-2 text-right tabular-nums text-foreground-muted">
                          {statCell(row[column.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {seasonRows.length > 1 && (
                    <tr className="border-t border-hairline">
                      <td className="py-2 pr-2 text-[11px] uppercase tracking-wide text-foreground-subtle">
                        All competitions
                      </td>
                      {totals.map((total, index) => (
                        <td
                          key={COLUMNS[index].key}
                          className="py-2 pl-2 text-right font-semibold tabular-nums text-foreground"
                        >
                          {statCell(total)}
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Only when a column was actually withheld, and only naming the
                ones that were. A reader who sees a dash in a total row can
                otherwise only conclude the provider reported nothing at all,
                when in fact it reported some competitions and not others —
                which is a different and more useful fact. */}
            {seasonRows.length > 1 && partialColumns.length > 0 && (
              <p className="px-1 text-[11px] leading-relaxed text-foreground-subtle">
                No total shown for {formatList(partialColumns)}: {providerLabel} reported{" "}
                {partialColumns.length === 1 ? "it" : "them"} for some of these competitions and not others, so a
                sum would cover fewer competitions than the figures beside it.
              </p>
            )}
          </div>
        );
      })}

      {canSync && (
        <InlineSyncButton
          label="Refresh season statistics"
          action={triggerPlayerSeasonStatisticsSync.bind(null, playerId, undefined)}
        />
      )}

      {anyUnlinked && (
        <p className="text-[11px] leading-relaxed text-foreground-subtle">
          Some competitions above aren&apos;t linked because KIVO hasn&apos;t synced them yet. Their numbers are real
          and complete — leaving the rows out would have made this career look smaller than it is.
        </p>
      )}
    </FadeIn>
  );
}
