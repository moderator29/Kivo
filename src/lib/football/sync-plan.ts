import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * KIVO_NEXT_GEN KN-107: what will need syncing, as opposed to what happened.
 *
 * Data Health is entirely retrospective — sync runs, anomalies, quota, failures.
 * Every one of those answers "what did the pipeline just do". None of them
 * answers the question an admin actually has before a matchday: *what is about
 * to be wrong*. Tomorrow's fixture between two clubs whose squads have never
 * been synced will render a Lineups tab with nothing in it, and today is when
 * that is cheap to fix.
 *
 * Three real gaps, all derived from tables that already exist. Nothing here is
 * predicted or scored — each item is a plain statement about rows that are
 * present or absent right now:
 *
 *   1. Upcoming fixtures whose teams have no squad synced (no `players` rows).
 *   2. Current seasons with no `standings` rows.
 *   3. Recently finished fixtures with no `lineups` rows.
 *
 * PostgREST has no anti-join, so each gap is "fetch the candidates, fetch what
 * exists, diff in memory". Every query is bounded — this is an ops panel, and a
 * planning surface that could itself become the slowest page in the admin app
 * would be a poor trade.
 */

type Client = SupabaseClient<Database>;

/** How far ahead "about to need syncing" looks. A week covers the next round
 * of fixtures in every competition shape KIVO supports without turning the
 * panel into a season-long backlog nobody acts on. */
const LOOKAHEAD_DAYS = 7;

/** How far back to look for finished fixtures whose details were never synced.
 * Beyond a week it stops being "this needs attention now" and becomes archive
 * cleanup, which is a different job. */
const LOOKBACK_DAYS = 7;

/** Per-section ceiling. An admin acts on the first few; a list of 400 is a
 * report, not a to-do. Each section reports whether it was truncated so the
 * panel can say so rather than quietly implying it found exactly this many. */
const SECTION_LIMIT = 25;

/** Bound on the fixtures scanned to build each section. */
const FIXTURE_SCAN_LIMIT = 300;

export interface MissingSquadItem {
  fixtureId: string;
  kickoffAt: string;
  label: string;
  /** The teams in this fixture with no squad synced — one or both. */
  teamsWithoutSquad: { id: string; name: string }[];
}

export interface MissingStandingsItem {
  seasonId: string;
  seasonName: string;
  competitionId: string;
  competitionName: string;
}

export interface MissingLineupsItem {
  fixtureId: string;
  kickoffAt: string;
  label: string;
}

export interface SyncPlan {
  missingSquads: { items: MissingSquadItem[]; truncated: boolean };
  missingStandings: { items: MissingStandingsItem[]; truncated: boolean };
  missingLineups: { items: MissingLineupsItem[]; truncated: boolean };
  /** Real window the plan was computed over, so the panel can state it rather
   * than leaving the reader to assume one. */
  lookaheadDays: number;
  lookbackDays: number;
}

function fixtureLabel(row: { home_team: { name: string } | null; away_team: { name: string } | null }): string {
  return `${row.home_team?.name ?? "Unknown team"} v ${row.away_team?.name ?? "Unknown team"}`;
}

/**
 * Takes a service-role client: this reads across every competition and team
 * regardless of the admin's own RLS-visible scope, and it is only ever called
 * from a page already gated by `canManageFootballData`.
 */
export async function buildSyncPlan(supabase: Client): Promise<SyncPlan> {
  const now = new Date();
  const lookahead = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
  const lookback = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const fixtureSelect = `id, kickoff_at, home_team_id, away_team_id,
     home_team:teams!fixtures_home_team_id_fkey(name),
     away_team:teams!fixtures_away_team_id_fkey(name)`;

  const [{ data: upcoming }, { data: recentlyFinished }, { data: currentSeasons }] = await Promise.all([
    supabase
      .from("fixtures")
      .select(fixtureSelect)
      .gte("kickoff_at", now.toISOString())
      .lt("kickoff_at", lookahead.toISOString())
      .order("kickoff_at", { ascending: true })
      .limit(FIXTURE_SCAN_LIMIT),
    supabase
      .from("fixtures")
      .select(fixtureSelect)
      .eq("status", "finished")
      .gte("kickoff_at", lookback.toISOString())
      .order("kickoff_at", { ascending: false })
      .limit(FIXTURE_SCAN_LIMIT),
    supabase
      .from("seasons")
      .select("id, name, competition_id, competition:competitions(name)")
      .eq("is_current", true)
      .limit(FIXTURE_SCAN_LIMIT),
  ]);

  const upcomingRows = upcoming ?? [];
  const finishedRows = recentlyFinished ?? [];
  const seasonRows = currentSeasons ?? [];

  // ── 1. Teams playing soon with no squad synced ──────────────────────────
  const upcomingTeamIds = [...new Set(upcomingRows.flatMap((f) => [f.home_team_id, f.away_team_id]))];
  const teamsWithSquad = new Set<string>();
  if (upcomingTeamIds.length > 0) {
    // Only the team column: presence is the whole question, and a squad is
    // ~25 rows per club, so selecting anything more would transfer thousands of
    // rows to compute a set membership test.
    const { data: squadRows } = await supabase
      .from("players")
      .select("current_team_id")
      .in("current_team_id", upcomingTeamIds);
    for (const row of squadRows ?? []) {
      if (row.current_team_id) teamsWithSquad.add(row.current_team_id);
    }
  }

  const missingSquadItems: MissingSquadItem[] = [];
  for (const fixture of upcomingRows) {
    const teamsWithoutSquad = [
      { id: fixture.home_team_id, name: fixture.home_team?.name ?? "Unknown team" },
      { id: fixture.away_team_id, name: fixture.away_team?.name ?? "Unknown team" },
    ].filter((team) => !teamsWithSquad.has(team.id));
    if (teamsWithoutSquad.length === 0) continue;
    missingSquadItems.push({
      fixtureId: fixture.id,
      kickoffAt: fixture.kickoff_at,
      label: fixtureLabel(fixture),
      teamsWithoutSquad,
    });
  }

  // ── 2. Current seasons with no standings ────────────────────────────────
  const seasonIds = seasonRows.map((s) => s.id);
  const seasonsWithStandings = new Set<string>();
  if (seasonIds.length > 0) {
    const { data: standingRows } = await supabase.from("standings").select("season_id").in("season_id", seasonIds);
    for (const row of standingRows ?? []) seasonsWithStandings.add(row.season_id);
  }

  const missingStandingsItems: MissingStandingsItem[] = seasonRows
    .filter((season) => !seasonsWithStandings.has(season.id))
    .map((season) => ({
      seasonId: season.id,
      seasonName: season.name,
      competitionId: season.competition_id,
      competitionName: season.competition?.name ?? "Unknown competition",
    }));

  // ── 3. Finished fixtures with no lineups ────────────────────────────────
  const finishedIds = finishedRows.map((f) => f.id);
  const fixturesWithLineups = new Set<string>();
  if (finishedIds.length > 0) {
    const { data: lineupRows } = await supabase.from("lineups").select("fixture_id").in("fixture_id", finishedIds);
    for (const row of lineupRows ?? []) fixturesWithLineups.add(row.fixture_id);
  }

  const missingLineupItems: MissingLineupsItem[] = finishedRows
    .filter((fixture) => !fixturesWithLineups.has(fixture.id))
    .map((fixture) => ({ fixtureId: fixture.id, kickoffAt: fixture.kickoff_at, label: fixtureLabel(fixture) }));

  return {
    missingSquads: {
      items: missingSquadItems.slice(0, SECTION_LIMIT),
      truncated: missingSquadItems.length > SECTION_LIMIT,
    },
    missingStandings: {
      items: missingStandingsItems.slice(0, SECTION_LIMIT),
      truncated: missingStandingsItems.length > SECTION_LIMIT,
    },
    missingLineups: {
      items: missingLineupItems.slice(0, SECTION_LIMIT),
      truncated: missingLineupItems.length > SECTION_LIMIT,
    },
    lookaheadDays: LOOKAHEAD_DAYS,
    lookbackDays: LOOKBACK_DAYS,
  };
}
