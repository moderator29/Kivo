import { CalendarPlus } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { GenerateGameweeksButton } from "@/components/admin/fantasy-gameweek-buttons";

/**
 * Generating a season's fantasy gameweeks, from Admin.
 *
 * ## Why this needed a home here at all
 *
 * Fantasy needs gameweeks and gameweeks are derived from a season's real
 * synced fixtures — nothing invented, no schedule. The action that derives them
 * existed only as a staff control on `/fantasy`, shown when an admin happened
 * to open a season with no gameweek open. So the fix for "fantasy is broken for
 * everyone in this season" was reachable only by an admin who first navigated
 * into the broken state as a player.
 *
 * ## Every row is a real season with a real fixture count
 *
 * A season with no synced fixtures cannot produce gameweeks, and the button for
 * it is disabled with that stated rather than failing after the press. The
 * counts are rows in `fixtures` and `fantasy_gameweeks`; a zero is a zero.
 */

type SeasonRow = {
  seasonId: string;
  label: string;
  fixtures: number;
  gameweeks: number;
};

export async function FantasyGameweekGenerator() {
  const supabase = createServerSupabaseClient();

  const { data: seasons } = await supabase
    .from("seasons")
    .select("id, name, competition:competitions(name, short_name)")
    .eq("is_current", true)
    .limit(50);

  if (!seasons || seasons.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-hairline-soft bg-surface-1 p-4">
        <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          <CalendarPlus className="h-3.5 w-3.5" strokeWidth={2} />
          Generate gameweeks
        </h3>
        <p className="text-xs text-foreground-muted">
          No season is marked current, so there is nothing to derive gameweeks from. A season becomes current when its
          competition&apos;s fixtures are synced.
        </p>
      </div>
    );
  }

  const seasonIds = seasons.map((season) => season.id);
  const [{ data: fixtureRows }, { data: gameweekRows }] = await Promise.all([
    supabase.from("fixtures").select("season_id").in("season_id", seasonIds).limit(20000),
    supabase.from("fantasy_gameweeks").select("season_id").in("season_id", seasonIds).limit(2000),
  ]);

  const fixturesBySeason = new Map<string, number>();
  for (const row of fixtureRows ?? []) {
    if (!row.season_id) continue;
    fixturesBySeason.set(row.season_id, (fixturesBySeason.get(row.season_id) ?? 0) + 1);
  }
  const gameweeksBySeason = new Map<string, number>();
  for (const row of gameweekRows ?? []) {
    if (!row.season_id) continue;
    gameweeksBySeason.set(row.season_id, (gameweeksBySeason.get(row.season_id) ?? 0) + 1);
  }

  const rows: SeasonRow[] = seasons
    .map((season) => ({
      seasonId: season.id,
      label: [season.competition?.short_name ?? season.competition?.name, season.name].filter(Boolean).join(" · "),
      fixtures: fixturesBySeason.get(season.id) ?? 0,
      gameweeks: gameweeksBySeason.get(season.id) ?? 0,
    }))
    // Seasons with fixtures but no gameweeks are the outstanding work, so they
    // sort first; seasons with nothing synced sort last, since nothing can be
    // done about them from this panel.
    .sort((a, b) => {
      const rank = (row: SeasonRow) => (row.fixtures === 0 ? 2 : row.gameweeks === 0 ? 0 : 1);
      return rank(a) - rank(b) || a.label.localeCompare(b.label);
    });

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-hairline-soft bg-surface-1 p-4">
      <div className="flex flex-col gap-1">
        <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          <CalendarPlus className="h-3.5 w-3.5" strokeWidth={2} />
          Generate gameweeks
        </h3>
        <p className="text-[11px] leading-relaxed text-foreground-subtle">
          Derived from the season&apos;s own synced fixtures — grouped by the provider&apos;s matchday where every
          fixture has one, otherwise bucketed by calendar week from the first kickoff. Existing gameweek rows are never
          touched, so a hand-adjusted deadline survives a re-run.
        </p>
      </div>

      <ul className="flex flex-col divide-y divide-hairline-soft">
        {rows.map((row) => (
          <li key={row.seasonId} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-foreground">{row.label || "Unnamed season"}</p>
              <p className="text-[11px] text-foreground-subtle">
                {row.fixtures === 0
                  ? "No fixtures synced"
                  : `${row.fixtures} fixture${row.fixtures === 1 ? "" : "s"} · ${
                      row.gameweeks === 0 ? "no gameweeks" : `${row.gameweeks} gameweeks`
                    }`}
              </p>
            </div>
            <GenerateGameweeksButton
              seasonId={row.seasonId}
              hasFixtures={row.fixtures > 0}
              hasGameweeks={row.gameweeks > 0}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
