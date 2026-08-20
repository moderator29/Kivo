import { CircleAlert, ListOrdered, ArrowLeftRight } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getActiveProviderStatus } from "@/lib/football";
import { getCompetitionScope } from "@/lib/football/competitions-config";
import { SCOPED_STANDINGS_LIMIT } from "@/lib/football/sync-standings-scope";
import { RefreshLeagueTablesButton, SyncTeamTransfersButton } from "@/components/admin/standings-transfers-buttons";

/**
 * League tables and transfers: what KIVO holds, and the two buttons that fill
 * them.
 *
 * ## Why this panel exists at all
 *
 * The founder's report was "no standing synced no transfer too fix it all it's
 * not calling it or anything". The last five words were the diagnosis, and they
 * were exactly right. Checked against the live database:
 *
 *   * `standings` — 0 rows. `sync_runs` has never held a single row with
 *     `entity_type = 'standing'`. `syncStandings` is complete and correct and
 *     had never once been called: the only automatic caller is the 05:00 cron,
 *     which ran on a morning when the provider account was still suspended, and
 *     the only manual caller was a per-season button that needs the operator to
 *     already know which of 85 season ids they want.
 *   * `transfers` — 0 rows, for a harder reason. Transfer history was fetched
 *     one player at a time by design, which meant a single 25-man squad cost a
 *     quarter of the day's entire allowance on a free tier. Nobody was ever
 *     going to press that twenty-five times, so the table stayed empty.
 *
 * Neither was a broken sync. Both were a missing button, and one of them also
 * needed a cheaper endpoint. See `syncScopedStandings` and `syncTeamTransfers`.
 *
 * ## What the counts here mean
 *
 * Every number is read from the rows themselves — `standings` for tables,
 * `transfers` for moves. A competition with no table shows a zero, not a blank,
 * because "no table yet" and "we didn't look" are different facts and the panel
 * that exists to answer the first must not be ambiguous about it.
 */

type TableRow = {
  competitionId: string;
  competitionName: string;
  rows: number;
  lastRefreshed: string | null;
  /** How many of this table's rows carry each of migration 0117's three
   *  optional provider fields. Counts, not verdicts — see OPTIONAL_COLUMNS. */
  optional: Record<OptionalColumn, number>;
};

/**
 * Migration 0117's three columns, surfaced as **what arrived**, never as a
 * defect count.
 *
 * API-Football sends a per-standings-row `description` ("Promotion - Champions
 * League (Group Stage)"), a `group` ("Group A") and a `form` string ("WWDLW").
 * The adapter's response interface declared none of the three, so all three
 * were silently discarded; 0117 added the columns and the adapter keeps them.
 *
 * RECOMMENDATIONS A8 recorded a deliberate refusal to turn these into a
 * data-quality check, and that refusal stands. They are OPTIONAL. A cup group
 * stage has a `group`; a domestic league does not, and never will. A
 * competition whose provider publishes no zone sentence is not defective.
 * Counting those nulls as "quality issues" would invent a signal, and a panel
 * reporting permanent, unfixable "problems" is a panel an operator learns to
 * scroll past — which costs more than the panel was ever worth.
 *
 * So: a count of the rows that HAVE each field, against the rows on file. That
 * answers the one operational question these columns actually raise — "will the
 * product be able to draw this table's qualification lines, or is that empty
 * because the provider says nothing?" — without asserting anything about
 * whether the answer is good.
 */
const OPTIONAL_COLUMNS = [
  { key: "zone", column: "zone_description", label: "Zones", what: "the qualification-zone sentence" },
  { key: "group", column: "group_label", label: "Groups", what: "the group label" },
  { key: "form", column: "form", label: "Form", what: "the provider's own last-five string" },
] as const;

type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number]["key"];

type ClubRow = {
  teamId: string;
  teamName: string;
  transfersOnFile: number;
};

/** Clubs offered a transfers button. Bounded because this is one row per club
 * in scope and a five-league catalogue is roughly a hundred of them; the ones
 * with nothing on file sort first, so the list is always showing the work that
 * is actually outstanding. */
const CLUB_LIST_LIMIT = 24;

export async function StandingsTransfersPanel() {
  const { name: providerName, label: providerLabel } = getActiveProviderStatus();
  const supabase = createServiceRoleSupabaseClient();
  const scope = getCompetitionScope(providerName ?? undefined);

  const [tables, clubs, totals] = await Promise.all([
    loadTables(supabase, providerName, scope.orderedIds),
    loadClubs(supabase),
    loadTotals(supabase),
  ]);

  return (
    <FadeIn>
      <section className="kivo-glass flex flex-col gap-5 rounded-2xl p-5">
        <header className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ListOrdered className="h-4 w-4 text-accent" strokeWidth={1.75} />
            League tables and transfers
          </h2>
          <p className="text-xs leading-relaxed text-foreground-muted">
            {totals.standings === 0 && totals.transfers === 0
              ? "Neither has ever been synced. Not because either sync failed — because nothing had called them. These two buttons are that call."
              : `${totals.standings} standings row(s) and ${totals.transfers} transfer(s) on file, via ${providerLabel}.`}
          </p>
        </header>

        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">League tables</h3>

          <p className="text-xs leading-relaxed text-foreground-muted">
            Three optional fields ride along with every standings row (migration 0117): the qualification-zone
            sentence, the group label, and the provider&apos;s own last-five form string. What follows each table is
            how many rows carry each — <span className="font-medium text-foreground">present</span>, not missing. A
            league the provider publishes no groups for is not defective, and counting that as a defect would be an
            invented signal.
          </p>

          {tables.length === 0 ? (
            <p className="flex items-start gap-1.5 text-xs text-foreground-muted">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              No current season has a competition the provider knows about yet. Adopt the allowlisted competitions in the
              club catalogue above first — a table cannot be fetched for a competition KIVO has never mapped.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-hairline-soft">
              {tables.map((table) => (
                <li key={table.competitionId} className="flex flex-col gap-1.5 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-foreground">{table.competitionName}</span>
                    <span className="shrink-0 text-xs text-foreground-subtle">
                      {table.rows === 0 ? "No table yet" : `${table.rows} rows`}
                    </span>
                  </div>
                  {table.rows > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {OPTIONAL_COLUMNS.map(({ key, column, label, what }) => {
                        const present = table.optional[key];
                        return (
                          <span
                            key={key}
                            title={`standings.${column} — ${what}. ${present} of ${table.rows} row(s) on file carry it.`}
                            className={
                              present > 0
                                ? "rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-foreground-muted"
                                : "rounded-full border border-hairline px-2 py-0.5 text-[11px] text-foreground-subtle"
                            }
                          >
                            {label} {present > 0 ? `${present}/${table.rows}` : "not published"}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <RefreshLeagueTablesButton limit={SCOPED_STANDINGS_LIMIT} />
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
            <ArrowLeftRight className="h-3.5 w-3.5" strokeWidth={2} />
            Transfers, one club at a time
          </h3>
          <p className="text-xs leading-relaxed text-foreground-muted">
            One request per club, for that club&apos;s whole recorded history — arrivals and departures, however many
            years deep. Clubs with nothing on file are listed first.
          </p>

          {clubs.length === 0 ? (
            <p className="text-xs text-foreground-muted">
              No clubs on file yet. Sync a competition&apos;s clubs in the club catalogue above first.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-hairline-soft">
              {clubs.map((club) => (
                <li key={club.teamId} className="flex items-center justify-between gap-3 py-2">
                  <span className="flex flex-col">
                    <span className="text-sm text-foreground">{club.teamName}</span>
                    <span className="text-[11px] text-foreground-subtle">
                      {club.transfersOnFile === 0 ? "Nothing on file" : `${club.transfersOnFile} on file`}
                    </span>
                  </span>
                  <SyncTeamTransfersButton teamId={club.teamId} teamName={club.teamName} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </FadeIn>
  );
}

async function loadTotals(supabase: ReturnType<typeof createServiceRoleSupabaseClient>) {
  const [{ count: standings }, { count: transfers }] = await Promise.all([
    supabase.from("standings").select("id", { count: "exact", head: true }),
    supabase.from("transfers").select("id", { count: "exact", head: true }),
  ]);
  return { standings: standings ?? 0, transfers: transfers ?? 0 };
}

/**
 * One row per current season whose competition the provider can be asked about,
 * in the operator's own configured order — the same ordering
 * `syncScopedStandings` syncs in, read from the same `getCompetitionScope`, so
 * the list cannot promise an order the button does not honour.
 */
async function loadTables(
  supabase: ReturnType<typeof createServiceRoleSupabaseClient>,
  providerName: string | null,
  scopeProviderIds: readonly string[],
): Promise<TableRow[]> {
  const { data: seasons } = await supabase
    .from("seasons")
    .select("id, competition_id, competition:competitions(name, short_name)")
    .eq("is_current", true)
    .limit(200);
  if (!seasons || seasons.length === 0) return [];

  const { data: mappings } = await supabase
    .from("provider_mappings")
    .select("kivo_entity_id, provider_entity_id")
    .eq("provider", providerName ?? "api-football")
    .eq("entity_type", "competition")
    .in("kivo_entity_id", [...new Set(seasons.map((s) => s.competition_id))]);

  const providerIdByCompetition = new Map((mappings ?? []).map((m) => [m.kivo_entity_id, m.provider_entity_id]));

  // The three optional columns are read here rather than counted with three
  // extra head-count queries: these rows are already being fetched to count them
  // and to find the newest `updated_at`, so this is the same round trip carrying
  // three more columns.
  const { data: standingRows } = await supabase
    .from("standings")
    .select("season_id, updated_at, zone_description, group_label, form")
    .in("season_id", seasons.map((s) => s.id))
    .limit(4000);

  const countBySeason = new Map<string, number>();
  const newestBySeason = new Map<string, string>();
  const optionalBySeason = new Map<string, Record<OptionalColumn, number>>();
  for (const row of standingRows ?? []) {
    countBySeason.set(row.season_id, (countBySeason.get(row.season_id) ?? 0) + 1);
    const known = newestBySeason.get(row.season_id);
    if (!known || row.updated_at > known) newestBySeason.set(row.season_id, row.updated_at);

    const tally = optionalBySeason.get(row.season_id) ?? { zone: 0, group: 0, form: 0 };
    // An empty string is not something the provider published — API-Football
    // sends "" for form where a side has played nothing yet — so it counts as
    // absent rather than as a populated field holding nothing.
    if (row.zone_description?.trim()) tally.zone += 1;
    if (row.group_label?.trim()) tally.group += 1;
    if (row.form?.trim()) tally.form += 1;
    optionalBySeason.set(row.season_id, tally);
  }

  const position = new Map(scopeProviderIds.map((id, index) => [id, index]));

  return seasons
    .filter((s) => providerIdByCompetition.has(s.competition_id))
    .filter((s) => position.size === 0 || position.has(providerIdByCompetition.get(s.competition_id) ?? ""))
    .map((s) => ({
      competitionId: s.competition_id,
      competitionName: s.competition?.short_name || s.competition?.name || "Unnamed competition",
      rows: countBySeason.get(s.id) ?? 0,
      lastRefreshed: newestBySeason.get(s.id) ?? null,
      optional: optionalBySeason.get(s.id) ?? { zone: 0, group: 0, form: 0 },
      sortKey: position.get(providerIdByCompetition.get(s.competition_id) ?? "") ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.sortKey - b.sortKey)
    .map(({ competitionId, competitionName, rows, lastRefreshed, optional }) => ({
      competitionId,
      competitionName,
      rows,
      lastRefreshed,
      optional,
    }));
}

/**
 * Clubs to offer a transfers button for, nothing-on-file first.
 *
 * Read from `competition_teams` (migration 0107) rather than from whoever
 * happens to have played a synced fixture — that distinction is the entire
 * point of that table, and reading `fixtures` here would reintroduce the bug it
 * was added to fix. Falls back to the plain club list only when the catalogue
 * has not been built yet, so the panel is useful before the first club sync
 * rather than empty until after it.
 */
async function loadClubs(supabase: ReturnType<typeof createServiceRoleSupabaseClient>): Promise<ClubRow[]> {
  const { data: membership } = await supabase.from("competition_teams").select("team_id").limit(2000);

  const teamIds = [...new Set((membership ?? []).map((m) => m.team_id))];

  const teamsQuery =
    teamIds.length > 0
      ? supabase.from("teams").select("id, name").in("id", teamIds).order("name").limit(400)
      : supabase.from("teams").select("id, name").order("name").limit(400);

  const [{ data: teams }, { data: transfers }] = await Promise.all([
    teamsQuery,
    supabase.from("transfers").select("from_team_id, to_team_id").limit(5000),
  ]);
  if (!teams) return [];

  const countByTeam = new Map<string, number>();
  for (const transfer of transfers ?? []) {
    for (const id of [transfer.from_team_id, transfer.to_team_id]) {
      if (id) countByTeam.set(id, (countByTeam.get(id) ?? 0) + 1);
    }
  }

  return teams
    .map((team) => ({ teamId: team.id, teamName: team.name, transfersOnFile: countByTeam.get(team.id) ?? 0 }))
    .sort((a, b) =>
      a.transfersOnFile === b.transfersOnFile
        ? a.teamName.localeCompare(b.teamName)
        : a.transfersOnFile - b.transfersOnFile,
    )
    .slice(0, CLUB_LIST_LIMIT);
}
