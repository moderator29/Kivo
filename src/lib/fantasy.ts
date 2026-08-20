import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { DEFAULT_FANTASY_PRICE } from "@/app/(app)/fantasy/fantasy-rules";
import type { Database } from "@/lib/supabase/types";
import { logError } from "@/lib/log";

type ServiceClient = SupabaseClient<Database>;

export type FantasyLeague = Database["public"]["Tables"]["fantasy_leagues"]["Row"];
export type FantasyTeam = Database["public"]["Tables"]["fantasy_teams"]["Row"];
export type FantasyGameweek = Database["public"]["Tables"]["fantasy_gameweeks"]["Row"];
export type FantasyRosterRow = Database["public"]["Tables"]["fantasy_rosters"]["Row"];

/**
 * Finds the caller's existing fantasy_teams row for a league, or creates one.
 * Mirrors getOrCreateProfile's shape: try the read first, fall back to an
 * insert, and re-read on a unique-violation race (two tabs both missing the
 * initial SELECT and racing to insert) rather than treating that as failure.
 */
export async function getOrCreateFantasyTeam(
  profileId: string,
  leagueId: string,
): Promise<{ team: FantasyTeam | null; error: string | null }> {
  const supabase = createServerSupabaseClient();

  const { data: existing } = await supabase
    .from("fantasy_teams")
    .select("*")
    .eq("league_id", leagueId)
    .eq("owner_profile_id", profileId)
    .maybeSingle();

  if (existing) return { team: existing, error: null };

  const { data: created, error } = await supabase
    .from("fantasy_teams")
    .insert({ owner_profile_id: profileId, league_id: leagueId, name: "My Team" })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: retried } = await supabase
        .from("fantasy_teams")
        .select("*")
        .eq("league_id", leagueId)
        .eq("owner_profile_id", profileId)
        .maybeSingle();
      return { team: retried ?? null, error: retried ? null : "Couldn't create your fantasy team. Try again." };
    }
    logError("fantasy.createTeam", error);
    return { team: null, error: "Couldn't create your fantasy team. Try again." };
  }

  return { team: created, error: null };
}

// Callers pass in whatever a search/picker query returned (up to 60 rows —
// see searchFantasyPlayers' own .limit(60)); cap here too so a future caller
// widening its own query can't turn this into an unbounded service-role
// write on every debounced keystroke.
const MAX_ENSURE_BATCH = 60;

/**
 * Lazily backfills the flat, clearly-arbitrary default price for any of the
 * given players who don't yet have a fantasy_player_prices row for this
 * season. Uses the service-role client deliberately: this is system
 * housekeeping ("every player needs a baseline price to appear in the
 * picker"), not a user-driven write — same rationale as notifications /
 * xp_ledger being service-role-written, and structurally the same
 * fallback-creation shape as getOrCreateProfile above. Never invents
 * per-player differentiation — every backfilled row gets the identical
 * default.
 *
 * Checks which players already have a row through the ordinary RLS-gated
 * client first (fantasy_player_prices is public-read) and only upserts the
 * missing delta through the service-role client — this is called on every
 * debounced keystroke of the player picker, so a search whose results are
 * already fully priced (the common case after the first backfill) does no
 * service-role write at all.
 */
export async function ensureFantasyPlayerPrices(seasonId: string, playerIds: string[]): Promise<void> {
  const uniqueIds = Array.from(new Set(playerIds)).slice(0, MAX_ENSURE_BATCH);
  if (uniqueIds.length === 0) return;

  const supabase = createServerSupabaseClient();
  const { data: existing } = await supabase
    .from("fantasy_player_prices")
    .select("player_id")
    .eq("season_id", seasonId)
    .in("player_id", uniqueIds);

  const existingIds = new Set((existing ?? []).map((row) => row.player_id));
  const missingIds = uniqueIds.filter((id) => !existingIds.has(id));
  if (missingIds.length === 0) return;

  const service = createServiceRoleSupabaseClient();
  const rows = missingIds.map((playerId) => ({
    player_id: playerId,
    season_id: seasonId,
    price: DEFAULT_FANTASY_PRICE,
  }));

  const { error } = await service
    .from("fantasy_player_prices")
    .upsert(rows, { onConflict: "player_id,season_id", ignoreDuplicates: true });

  if (error) {
    logError("fantasy.backfillPlayerPrices", error);
  }
}

export type CarryForwardResult = { carriedFromGameweekNumber: number | null };

/** One team whose squad was carried forward by the bulk path — i.e. whose
 * owner never opened /fantasy for this gameweek. KN-61 uses this to notify
 * them; nothing else in the product would have. */
export type CarriedForwardTeam = {
  fantasyTeamId: string;
  ownerProfileId: string;
  fromGameweekNumber: number;
};

export type BulkCarryForwardResult = { teamsCarried: number; carried: CarriedForwardTeam[] };

/**
 * Lazily carries a team's squad forward into a gameweek that has no roster
 * rows of its own yet — real fantasy-football games never start a new
 * gameweek with an empty squad, they start it as whatever the manager last
 * set, and now that generateFantasyGameweeks (see
 * src/app/admin/football/fantasy-actions.ts) can actually flip
 * `is_current` onto a new gameweek, a team hitting that empty state is a
 * usability gap, not a deliberate "start fresh" moment.
 *
 * Idempotent by construction: it upserts against
 * fantasy_rosters_unique_slot (fantasy_team_id, gameweek_id, player_id) —
 * the same real constraint setGameweekRoster's own upsert in
 * src/app/(app)/fantasy/actions.ts targets — with `ignoreDuplicates: true`,
 * so two concurrent page loads racing to carry the same gameweek forward
 * both succeed, only one actually inserts, and calling this again once rows
 * already exist for the gameweek is a no-op read (the caller only invokes
 * this when its own initial roster query for the gameweek came back empty).
 * ## Why this runs as service_role (changed 2026-08-19)
 *
 * It used to run on the caller's own RLS-gated client, on the reasoning that
 * it only ever writes rows for the caller's own team — which
 * `fantasy_rosters_all_own` allowed. That policy is gone. The security sweep
 * replaced it with four policies whose INSERT/UPDATE/DELETE arms require
 * `deadline_at > now()`, closing a real hole (a user could PATCH their squad
 * after kickoff with the results known).
 *
 * That fix is correct, and it makes this caller's classification wrong. This
 * function writes rows for the CURRENT gameweek, including after its deadline
 * — which is precisely the moment it exists for, because a manager who never
 * opened the app before the deadline is exactly who needs their squad carried.
 * On the user's client that write is now refused, and the failure is silent:
 * the manager sees an EMPTY squad with the deadline gone and no way to rebuild
 * it.
 *
 * So it moves to the service-role client, and that is an honest
 * reclassification rather than a way around the policy. Carry-forward is KIVO
 * applying a documented rule on the manager's behalf; it is not the manager
 * editing a locked squad. `carryForwardMissingFantasyRosters` below — the
 * scorer's bulk equivalent, doing the identical thing — already ran this way.
 *
 * The safety that the RLS ownership check used to provide is replaced by
 * construction rather than dropped: every row written below is built from
 * `fantasyTeamId`, the caller's own team id, and from a prior roster read
 * scoped to that same id. There is no path by which a different team's id
 * reaches the insert.
 *
 * Player eligibility: this schema has no injury/availability/suspension/
 * transfer-window-lock concept for players anywhere — `players` only carries
 * synced provider facts (name, position, current_team_id) and `transfers` is
 * a historical log (see 0006_transfers.sql), not a live eligibility flag.
 * The only way a previously-rostered player could be invalid to carry
 * forward is if the player row itself no longer exists, and
 * fantasy_rosters.player_id is `on delete cascade` from `players` (see
 * 0001_kivo_core_schema.sql), so a roster row referencing a deleted player
 * cannot exist to be read here in the first place. Nothing else to check
 * without inventing an eligibility concept this codebase doesn't have.
 */
export async function carryForwardFantasyRoster(
  fantasyTeamId: string,
  seasonId: string,
  currentGameweekId: string,
  currentGameweekNumber: number,
): Promise<CarryForwardResult> {
  if (currentGameweekNumber <= 1) return { carriedFromGameweekNumber: null };

  // See the doc comment above: service-role because the write it performs is
  // legitimately after the gameweek's deadline, which user-facing policy
  // (correctly) forbids.
  let supabase: ServiceClient;
  try {
    supabase = createServiceRoleSupabaseClient();
  } catch (error) {
    // Missing service-role key. Degrade to not carrying forward rather than
    // throwing on somebody's page load — the scorer's bulk pass will still
    // carry the squad before it is scored, so nothing is lost but the notice.
    logError("fantasy.carryForwardRoster.clientUnavailable", error, { fantasyTeamId });
    return { carriedFromGameweekNumber: null };
  }

  // Walk back through this season's earlier gameweeks, most recent first,
  // for the last one this team actually built a squad for — a team could
  // have skipped a gameweek entirely (missed the deadline with no picks),
  // so "immediately previous gameweek" isn't always the right source.
  const { data: priorGameweeks } = await supabase
    .from("fantasy_gameweeks")
    .select("id, number")
    .eq("season_id", seasonId)
    .lt("number", currentGameweekNumber)
    .order("number", { ascending: false });
  if (!priorGameweeks || priorGameweeks.length === 0) return { carriedFromGameweekNumber: null };

  for (const gw of priorGameweeks) {
    const { data: priorRoster } = await supabase
      .from("fantasy_rosters")
      .select("player_id, is_starting, is_captain, is_vice_captain")
      .eq("fantasy_team_id", fantasyTeamId)
      .eq("gameweek_id", gw.id);
    if (!priorRoster || priorRoster.length === 0) continue;

    const rows = priorRoster.map((r) => ({
      fantasy_team_id: fantasyTeamId,
      gameweek_id: currentGameweekId,
      player_id: r.player_id,
      is_starting: r.is_starting,
      is_captain: r.is_captain,
      is_vice_captain: r.is_vice_captain,
    }));

    const { error } = await supabase
      .from("fantasy_rosters")
      .upsert(rows, { onConflict: "fantasy_team_id,gameweek_id,player_id", ignoreDuplicates: true });

    if (error) {
      logError("fantasy.carryForwardRoster", error);
      return { carriedFromGameweekNumber: null };
    }
    return { carriedFromGameweekNumber: gw.number };
  }

  return { carriedFromGameweekNumber: null };
}

/**
 * Bulk counterpart to carryForwardFantasyRoster, for the one other place a
 * gameweek's rosters get read besides the squad-builder page: admin-triggered
 * scoring (scoreFantasyGameweek in src/app/admin/football/fantasy-actions.ts).
 * carryForwardFantasyRoster above is lazy and per-viewer — it only ever runs
 * for the one team whose owner happens to load /fantasy for this gameweek
 * before scoring does. A team whose owner hasn't opened the app since the
 * gameweek turned current would otherwise have zero fantasy_rosters rows at
 * scoring time and score nothing, even though every real fantasy game treats
 * an untouched gameweek as "kept the same squad," not "fielded no one." This
 * closes that gap by carrying forward every team in the gameweek's season
 * that still has no roster rows, immediately before scoring reads them.
 *
 * Runs under the service-role client (same as the rest of scoreFantasyGameweek)
 * because it has to write rows for every team in the season's leagues, not
 * just one caller's own team — fantasy_rosters_all_own would only allow a
 * team's own owner to write its rows. Batched across all teams needing a
 * carry rather than one query per team: teams sharing this codebase's fantasy
 * feature are not expected to number in the thousands, but there's no reason
 * to pay a per-team round trip when the whole set can be resolved in four
 * queries total, matching the batching approach sync.ts's batchFindMappedId
 * already uses for the same reason (RECOMMENDATIONS.md item 27).
 *
 * Idempotent the same way carryForwardFantasyRoster is: an upsert against
 * fantasy_rosters_unique_slot with ignoreDuplicates, so calling this again
 * once a team already has rows (whether from this function, from the lazy
 * per-viewer path, or from the team's own edits) is a safe no-op for that
 * team. Same player-eligibility reasoning as carryForwardFantasyRoster: this
 * schema has no injury/availability/transfer-lock concept to check.
 */
export async function carryForwardMissingFantasyRosters(
  service: ServiceClient,
  seasonId: string,
  currentGameweekId: string,
  currentGameweekNumber: number,
): Promise<BulkCarryForwardResult> {
  if (currentGameweekNumber <= 1) return { teamsCarried: 0, carried: [] };

  const { data: leagues } = await service.from("fantasy_leagues").select("id").eq("season_id", seasonId);
  const leagueIds = (leagues ?? []).map((l) => l.id);
  if (leagueIds.length === 0) return { teamsCarried: 0, carried: [] };

  // KN-61: owners come back with the teams now, because a squad carried
  // forward here belongs to somebody who never opened the app for this
  // gameweek — the one case where nobody sees the "Carried forward from GW{N}"
  // badge, and therefore the one case that needs telling.
  const { data: teams } = await service
    .from("fantasy_teams")
    .select("id, owner_profile_id")
    .in("league_id", leagueIds);
  const allTeamIds = (teams ?? []).map((t) => t.id);
  if (allTeamIds.length === 0) return { teamsCarried: 0, carried: [] };
  const ownerByTeamId = new Map((teams ?? []).map((t) => [t.id, t.owner_profile_id]));

  const { data: existingRosterTeams } = await service
    .from("fantasy_rosters")
    .select("fantasy_team_id")
    .eq("gameweek_id", currentGameweekId)
    .in("fantasy_team_id", allTeamIds);
  const haveRoster = new Set((existingRosterTeams ?? []).map((r) => r.fantasy_team_id));
  const missingTeamIds = allTeamIds.filter((id) => !haveRoster.has(id));
  if (missingTeamIds.length === 0) return { teamsCarried: 0, carried: [] };

  const { data: priorGameweeks } = await service
    .from("fantasy_gameweeks")
    .select("id, number")
    .eq("season_id", seasonId)
    .lt("number", currentGameweekNumber)
    .order("number", { ascending: false });
  if (!priorGameweeks || priorGameweeks.length === 0) return { teamsCarried: 0, carried: [] };

  const priorGameweekIds = priorGameweeks.map((g) => g.id);
  const gwNumberById = new Map(priorGameweeks.map((g) => [g.id, g.number]));

  const { data: priorRosterRows } = await service
    .from("fantasy_rosters")
    .select("fantasy_team_id, gameweek_id, player_id, is_starting, is_captain, is_vice_captain")
    .in("fantasy_team_id", missingTeamIds)
    .in("gameweek_id", priorGameweekIds);
  if (!priorRosterRows || priorRosterRows.length === 0) return { teamsCarried: 0, carried: [] };

  const rowsByTeam = new Map<string, typeof priorRosterRows>();
  for (const row of priorRosterRows) {
    const list = rowsByTeam.get(row.fantasy_team_id);
    if (list) list.push(row);
    else rowsByTeam.set(row.fantasy_team_id, [row]);
  }

  // For each team, keep only the rows from its single most recent prior
  // gameweek that has any rows — a team could have skipped a gameweek
  // entirely, so "immediately previous" isn't always the right source
  // (same reasoning carryForwardFantasyRoster's own walk-back uses).
  const toInsert: {
    fantasy_team_id: string;
    gameweek_id: string;
    player_id: string;
    is_starting: boolean;
    is_captain: boolean;
    is_vice_captain: boolean;
  }[] = [];
  let teamsCarried = 0;
  const carried: CarriedForwardTeam[] = [];
  for (const [teamId, rows] of rowsByTeam) {
    let bestNumber = -1;
    for (const r of rows) {
      const num = gwNumberById.get(r.gameweek_id) ?? -1;
      if (num > bestNumber) bestNumber = num;
    }
    const bestRows = rows.filter((r) => gwNumberById.get(r.gameweek_id) === bestNumber);
    if (bestRows.length === 0) continue;
    teamsCarried++;
    const ownerProfileId = ownerByTeamId.get(teamId);
    if (ownerProfileId) {
      carried.push({ fantasyTeamId: teamId, ownerProfileId, fromGameweekNumber: bestNumber });
    }
    for (const r of bestRows) {
      toInsert.push({
        fantasy_team_id: teamId,
        gameweek_id: currentGameweekId,
        player_id: r.player_id,
        is_starting: r.is_starting,
        is_captain: r.is_captain,
        is_vice_captain: r.is_vice_captain,
      });
    }
  }
  if (toInsert.length === 0) return { teamsCarried: 0, carried: [] };

  const { error } = await service
    .from("fantasy_rosters")
    .upsert(toInsert, { onConflict: "fantasy_team_id,gameweek_id,player_id", ignoreDuplicates: true });
  if (error) {
    logError("fantasy.bulkCarryForwardRosters", error);
    return { teamsCarried: 0, carried: [] };
  }

  return { teamsCarried, carried };
}

const GAMEWEEK_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type GameweekFixtureGroup = { number: number; deadlineAt: string; fixtureIds: string[] };

/**
 * Groups a season's fixtures (must already be ordered by kickoff_at
 * ascending — both callers below query that way) into gameweeks: by the
 * provider's own `matchday` when every fixture in the season has one, else
 * bucketed by calendar week from the season's first kickoff and renumbered
 * 1..N chronologically. This is the exact grouping generateFantasyGameweeks
 * (src/app/admin/football/fantasy-actions.ts) uses to create
 * fantasy_gameweeks rows in the first place, extracted here so
 * scoreFantasyGameweek can find precisely the same fixture set for a given
 * gameweek's scoring pass — the two must never disagree about which
 * fixtures belong to which gameweek number.
 */
export function groupFixturesByGameweek(
  fixtures: { id: string; matchday: number | null; kickoff_at: string }[],
): Map<number, GameweekFixtureGroup> {
  const groups = new Map<number, GameweekFixtureGroup>();
  if (fixtures.length === 0) return groups;

  const allHaveMatchday = fixtures.every((f) => f.matchday !== null);
  if (allHaveMatchday) {
    for (const f of fixtures) {
      const number = f.matchday as number;
      const existing = groups.get(number);
      if (!existing) {
        groups.set(number, { number, deadlineAt: f.kickoff_at, fixtureIds: [f.id] });
      } else {
        existing.fixtureIds.push(f.id);
        if (f.kickoff_at < existing.deadlineAt) existing.deadlineAt = f.kickoff_at;
      }
    }
    return groups;
  }

  const seasonStartMs = new Date(fixtures[0].kickoff_at).getTime();
  const byWeekIndex = new Map<number, { deadlineAt: string; fixtureIds: string[] }>();
  for (const f of fixtures) {
    const weekIndex = Math.floor((new Date(f.kickoff_at).getTime() - seasonStartMs) / GAMEWEEK_WEEK_MS);
    const existing = byWeekIndex.get(weekIndex);
    if (!existing) {
      byWeekIndex.set(weekIndex, { deadlineAt: f.kickoff_at, fixtureIds: [f.id] });
    } else {
      existing.fixtureIds.push(f.id);
      if (f.kickoff_at < existing.deadlineAt) existing.deadlineAt = f.kickoff_at;
    }
  }
  const sortedWeekIndexes = [...byWeekIndex.keys()].sort((a, b) => a - b);
  sortedWeekIndexes.forEach((weekIndex, i) => {
    const number = i + 1;
    const bucket = byWeekIndex.get(weekIndex)!;
    groups.set(number, { number, deadlineAt: bucket.deadlineAt, fixtureIds: bucket.fixtureIds });
  });
  return groups;
}

/** Fetches fantasy_price for a set of players in a season, defaulting any
 * still-missing row to DEFAULT_FANTASY_PRICE in memory (does not write) —
 * used where a fire-and-forget backfill isn't warranted (e.g. read paths
 * that already called ensureFantasyPlayerPrices upstream). */
export async function getFantasyPriceMap(seasonId: string, playerIds: string[]): Promise<Map<string, number>> {
  const uniqueIds = Array.from(new Set(playerIds));
  const map = new Map<string, number>();
  if (uniqueIds.length === 0) return map;

  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from("fantasy_player_prices")
    .select("player_id, price")
    .eq("season_id", seasonId)
    .in("player_id", uniqueIds);

  for (const id of uniqueIds) map.set(id, DEFAULT_FANTASY_PRICE);
  for (const row of data ?? []) map.set(row.player_id, row.price);
  return map;
}
