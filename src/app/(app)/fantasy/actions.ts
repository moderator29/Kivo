"use server";

import { logError } from "@/lib/log";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { getOrCreateFantasyTeam, ensureFantasyPlayerPrices } from "@/lib/fantasy";
import { checkRateLimit } from "@/lib/rate-limit";
import { awardBadge } from "@/lib/rewards";
import { escapeLikePattern } from "@/lib/text";
import { PUBLIC_FANTASY_LEAGUES_PAGE_SIZE } from "./browse/constants";
import {
  generateInviteCode,
  positionGroup,
  validateRoster,
  DEFAULT_FANTASY_PRICE,
  type PositionGroup,
  type RosterPick,
} from "./fantasy-rules";

const LEAGUE_NAME_MAX = 60;
const INVITE_CODE_ATTEMPTS = 5;

// The exact, fixed set of user-safe messages redeem_invite_code() raises or
// returns by design (see supabase/migrations/0024_redeem_invite_code_durable_throttle.sql).
// Anything else — a constraint violation, a column/type error, any other
// unexpected failure — is an internal detail that must never reach the
// client as-is (RECOMMENDATIONS item 41).
const KNOWN_REDEEM_INVITE_CODE_ERRORS = new Set([
  "You must be signed in to join a league.",
  "You are doing that a bit too fast. Please wait a moment and try again.",
  "Invalid invite code. Check the code and try again.",
  "This league is full.",
]);

export async function createFantasyLeague(input: {
  name: string;
  seasonId: string;
  isPrivate: boolean;
  maxTeams: number;
}) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in to create a league.", leagueId: null };

  const name = input.name.trim();
  if (!name || name.length > LEAGUE_NAME_MAX) {
    return { error: `League name must be between 1 and ${LEAGUE_NAME_MAX} characters.`, leagueId: null };
  }
  if (!Number.isInteger(input.maxTeams) || input.maxTeams < 2 || input.maxTeams > 50) {
    return { error: "League size must be between 2 and 50 teams.", leagueId: null };
  }
  if (!input.seasonId) {
    return { error: "Pick a season for this league.", leagueId: null };
  }

  const supabase = createServerSupabaseClient();

  for (let attempt = 0; attempt < INVITE_CODE_ATTEMPTS; attempt++) {
    const inviteCode = generateInviteCode();
    const { data: league, error } = await supabase
      .from("fantasy_leagues")
      .insert({
        name,
        creator_profile_id: profile.id,
        season_id: input.seasonId,
        is_private: input.isPrivate,
        invite_code: inviteCode,
        max_teams: input.maxTeams,
      })
      .select("id")
      .single();

    if (!error && league) {
      const { error: teamError } = await getOrCreateFantasyTeam(profile.id, league.id);
      if (teamError) return { error: teamError, leagueId: null };
      // A real fantasy_teams row now exists for this profile — genuinely
      // "joined" a league, same condition redeem_invite_code satisfies below.
      await awardBadge(profile.id, "fantasy_league_joined");
      revalidatePath("/fantasy");
      return { error: null, leagueId: league.id };
    }

    if (error?.code === "23505") continue; // invite_code collision — retry with a fresh code
    logError("fantasy.createLeague", error);
    return { error: "Couldn't create your league. Try again.", leagueId: null };
  }

  return { error: "Couldn't generate a unique invite code. Try again.", leagueId: null };
}

export async function joinFantasyLeague(inviteCode: string) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in to join a league." };

  // Also guards against brute-forcing another league's invite code.
  const rateLimit = await checkRateLimit(`user:${profile.id}`, "join_fantasy_league", 5, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  const code = inviteCode.trim().toUpperCase();
  if (!code) return { error: "Enter an invite code." };

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.rpc("redeem_invite_code", { p_invite_code: code });

  // redeem_invite_code raises for "not signed in" / "too many attempts"
  // (nothing written yet at that point, so aborting the transaction is
  // safe) and returns a row with `error_message` set for "invalid code" /
  // "league full" instead of raising (raising there would roll back the
  // throttle attempt this same call just recorded — see the migration's
  // comment). Either channel can carry one of a fixed, known set of
  // user-safe messages; anything outside that set — a constraint violation,
  // a column/type error, any other unexpected failure — is an internal
  // detail that must never reach the client as-is.
  const message = error ? error.message : (data?.[0]?.error_message ?? null);
  if (message) {
    return { error: KNOWN_REDEEM_INVITE_CODE_ERRORS.has(message) ? message : "Something went wrong. Try again." };
  }

  await awardBadge(profile.id, "fantasy_league_joined");

  revalidatePath("/fantasy");
  return { error: null };
}

/**
 * The roster writer.
 *
 * ## Why these actions write as service_role
 *
 * `fantasy_rosters` has no user-facing INSERT/UPDATE/DELETE policy. RLS is
 * default-deny, so the table is not writable through PostgREST by any
 * authenticated user at all, and these validated actions are the only writers.
 *
 * That is deliberate and it was the only complete answer available. The squad
 * rules that matter most — the budget, the squad size, the formation, the
 * per-club cap — are properties of the SET of fifteen rows, not of any row in
 * it. "This squad costs 99.5 of 100" is unanswerable while looking at one
 * player, and RLS evaluates `WITH CHECK` per row. A policy carrying ownership
 * and the deadline (which are per-row facts, and were the previous state) closes
 * "edit after kickoff" and leaves "field sixteen players, or fifteen strikers,
 * or £300 of squad" wide open — while looking like the rules were enforced at
 * the data layer, which is the version that stops people checking.
 *
 * ## What that costs, and what replaces it
 *
 * The database no longer backstops the ownership check. So the ownership check
 * here is load-bearing rather than belt-and-braces, and it is written to be
 * checkable: `profile` comes from the session via `getOrCreateProfile()`, never
 * from an argument, and it is compared against the team's own
 * `owner_profile_id` read fresh from the database. A caller cannot influence
 * either side of that comparison.
 *
 * Reads stay on the user's RLS-gated client for the same reason — only the
 * mutations need the elevated one, and narrowing the elevation to exactly the
 * statements that require it is the difference between a considered exception
 * and a habit.
 */
function rosterWriter() {
  return createServiceRoleSupabaseClient();
}

/**
 * Replaces a team's full 15-player squad for a gameweek. Deadline + budget +
 * formation are all re-checked here against live data (never trusting the
 * client's numbers), with RLS + DB constraints (ownership, captain-xor-vice,
 * one-slot-per-player) as the final backstop underneath.
 */
export async function setGameweekRoster(
  fantasyTeamId: string,
  gameweekId: string,
  picks: { playerId: string; isStarting: boolean }[],
) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in." };

  const rateLimit = await checkRateLimit(`user:${profile.id}`, "set_gameweek_roster", 10, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  const supabase = createServerSupabaseClient();

  const { data: gameweek } = await supabase
    .from("fantasy_gameweeks")
    .select("id, deadline_at, season_id")
    .eq("id", gameweekId)
    .maybeSingle();
  if (!gameweek) return { error: "That gameweek no longer exists." };
  if (new Date(gameweek.deadline_at) <= new Date()) {
    return { error: "The deadline for this gameweek has passed. Your squad is locked." };
  }

  const { data: team } = await supabase
    .from("fantasy_teams")
    .select("id, owner_profile_id, league:fantasy_leagues(season_id)")
    .eq("id", fantasyTeamId)
    .maybeSingle();
  if (!team || team.owner_profile_id !== profile.id) return { error: "You don't own that fantasy team." };
  if (team.league?.season_id !== gameweek.season_id) {
    return { error: "This gameweek doesn't belong to your league's season." };
  }

  const playerIds = picks.map((p) => p.playerId);
  if (new Set(playerIds).size !== playerIds.length) {
    return { error: "Each player can only appear once in your squad." };
  }
  if (playerIds.length === 0) {
    return { error: "Add players to your squad before saving." };
  }

  const { data: players } = await supabase.from("players").select("id, position, full_name, known_as").in("id", playerIds);
  await ensureFantasyPlayerPrices(gameweek.season_id, playerIds);
  const { data: prices } = await supabase
    .from("fantasy_player_prices")
    .select("player_id, price")
    .eq("season_id", gameweek.season_id)
    .in("player_id", playerIds);
  const priceMap = new Map((prices ?? []).map((p) => [p.player_id, p.price]));

  const rosterPicks: RosterPick[] = picks.map((pick) => {
    const player = players?.find((pl) => pl.id === pick.playerId);
    return {
      playerId: pick.playerId,
      positionGroup: positionGroup(player?.position ?? null),
      price: priceMap.get(pick.playerId) ?? DEFAULT_FANTASY_PRICE,
      isStarting: pick.isStarting,
      name: player?.known_as ?? player?.full_name ?? undefined,
    };
  });

  const validation = validateRoster(rosterPicks);
  if (!validation.ok) return { error: validation.error };

  // Preserve captain / vice-captain across a resave for players still in the
  // squad, rather than silently clearing them every time the roster is saved.
  const { data: existingRoster } = await supabase
    .from("fantasy_rosters")
    .select("player_id, is_captain, is_vice_captain")
    .eq("fantasy_team_id", fantasyTeamId)
    .eq("gameweek_id", gameweekId);

  const existingIds = new Set((existingRoster ?? []).map((r) => r.player_id));
  const newIds = new Set(playerIds);
  const toRemove = [...existingIds].filter((id) => !newIds.has(id));

  // docs/BUG_AUDIT_2026-08-18.md S4: both ids used to be read straight off the
  // *old* roster and written back unconditionally. If the captain was one of
  // the players being transferred out, that id matched nobody in the new
  // squad, so every row got is_captain = false — validateRoster does not
  // require a captain, so the save succeeded, said nothing, and the manager
  // played the gameweek with nobody's points doubled
  // (fantasy-scoring.ts:39-48 doubles purely on these two flags).
  const previousCaptainId = existingRoster?.find((r) => r.is_captain)?.player_id;
  const previousViceCaptainId = existingRoster?.find((r) => r.is_vice_captain)?.player_id;
  let captainId = previousCaptainId && newIds.has(previousCaptainId) ? previousCaptainId : undefined;
  let viceCaptainId = previousViceCaptainId && newIds.has(previousViceCaptainId) ? previousViceCaptainId : undefined;

  // Losing the captain is precisely what a vice-captain exists for, so the
  // armband passes rather than being dropped. If the vice went too, no
  // captain is invented — picking one for the manager would be guessing at
  // their intent — and the builder already renders "No captain selected —
  // their points won't be doubled this gameweek."
  let notice: string | null = null;
  if (!captainId && viceCaptainId) {
    captainId = viceCaptainId;
    viceCaptainId = undefined;
    const promoted = players?.find((pl) => pl.id === captainId);
    const promotedName = promoted?.known_as ?? promoted?.full_name ?? "Your vice-captain";
    notice = `${promotedName} is now your captain — the previous captain left your squad.`;
  } else if (!captainId && previousCaptainId) {
    notice = "Your captain left the squad. Pick a new one so their points get doubled.";
  }

  const writer = rosterWriter();

  if (toRemove.length > 0) {
    const { error: removeError } = await writer
      .from("fantasy_rosters")
      .delete()
      .eq("fantasy_team_id", fantasyTeamId)
      .eq("gameweek_id", gameweekId)
      .in("player_id", toRemove);
    if (removeError) {
      logError("fantasy.removeDroppedRosterPicks", removeError);
      return { error: "Couldn't save your squad. Try again." };
    }
  }

  const rows = picks.map((pick) => ({
    fantasy_team_id: fantasyTeamId,
    gameweek_id: gameweekId,
    player_id: pick.playerId,
    is_starting: pick.isStarting,
    is_captain: pick.playerId === captainId,
    is_vice_captain: pick.playerId === viceCaptainId,
  }));

  const { error: upsertError } = await writer
    .from("fantasy_rosters")
    .upsert(rows, { onConflict: "fantasy_team_id,gameweek_id,player_id" });

  if (upsertError) {
    logError("fantasy.saveRoster", upsertError);
    return { error: "Couldn't save your squad. Try again." };
  }

  revalidatePath("/fantasy");
  // The resolved armband goes back to the caller so the builder's client-side
  // roster reflects a promotion immediately, instead of contradicting the
  // notice above it with "No captain selected".
  return {
    error: null,
    notice,
    captainPlayerId: captainId ?? null,
    viceCaptainPlayerId: viceCaptainId ?? null,
  };
}

export async function setFantasyCaptain(
  fantasyTeamId: string,
  gameweekId: string,
  playerId: string,
  role: "captain" | "vice_captain",
) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in." };

  const supabase = createServerSupabaseClient();

  const { data: gameweek } = await supabase
    .from("fantasy_gameweeks")
    .select("deadline_at")
    .eq("id", gameweekId)
    .maybeSingle();
  if (!gameweek) return { error: "That gameweek no longer exists." };
  if (new Date(gameweek.deadline_at) <= new Date()) {
    return { error: "The deadline for this gameweek has passed. Your squad is locked." };
  }

  const { data: team } = await supabase
    .from("fantasy_teams")
    .select("id, owner_profile_id")
    .eq("id", fantasyTeamId)
    .maybeSingle();
  if (!team || team.owner_profile_id !== profile.id) return { error: "You don't own that fantasy team." };

  const { data: rosterRows } = await supabase
    .from("fantasy_rosters")
    .select("id, player_id, is_captain, is_vice_captain")
    .eq("fantasy_team_id", fantasyTeamId)
    .eq("gameweek_id", gameweekId);
  if (!rosterRows) return { error: "Couldn't load your squad." };

  const target = rosterRows.find((r) => r.player_id === playerId);
  if (!target) return { error: "That player isn't in your squad for this gameweek." };

  const isCaptainRole = role === "captain";
  const targetHoldsOther = isCaptainRole ? target.is_vice_captain : target.is_captain;
  if (targetHoldsOther) {
    return {
      error: `That player is already your ${isCaptainRole ? "vice-captain" : "captain"}. Change that first.`,
    };
  }

  const holderIds = rosterRows
    .filter((r) => (isCaptainRole ? r.is_captain : r.is_vice_captain) && r.id !== target.id)
    .map((r) => r.id);

  // See rosterWriter(): the ownership check above is what authorises this, and
  // the rows being touched were read through the user's own RLS-gated client,
  // so `holderIds` and `target.id` can only ever be this team's rows.
  const writer = rosterWriter();

  if (holderIds.length > 0) {
    const { error: clearError } = isCaptainRole
      ? await writer.from("fantasy_rosters").update({ is_captain: false }).in("id", holderIds)
      : await writer.from("fantasy_rosters").update({ is_vice_captain: false }).in("id", holderIds);
    if (clearError) {
      logError("fantasy.clearPreviousCaptain", clearError);
      return { error: "Couldn't update captaincy. Try again." };
    }
  }

  const { error: setError } = isCaptainRole
    ? await writer.from("fantasy_rosters").update({ is_captain: true }).eq("id", target.id)
    : await writer.from("fantasy_rosters").update({ is_vice_captain: true }).eq("id", target.id);
  if (setError) {
    logError("fantasy.setCaptain", setError);
    return { error: "Couldn't update captaincy. Try again." };
  }

  revalidatePath("/fantasy");
  return { error: null };
}

export type FantasyPlayerSearchResult = {
  id: string;
  name: string;
  position: string | null;
  positionGroup: PositionGroup | "Other";
  teamName: string | null;
  teamCrestUrl: string | null;
  price: number;
};

/** Search/filter action backing the player picker — kept as a server action
 * called on demand (not a bulk page-load fetch) since the synced player
 * table can grow large over time. */
export async function searchFantasyPlayers(
  seasonId: string,
  query: string,
  position: PositionGroup | "All",
): Promise<{ error: string | null; players: FantasyPlayerSearchResult[] }> {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in.", players: [] };

  // RECOMMENDATIONS.md item 198: called on every debounced keystroke of the
  // player picker and (via ensureFantasyPlayerPrices) can drive service-role
  // writes, so it gets the same per-profile sliding window as the other
  // search endpoints even though the caller is always signed in.
  const rateLimit = await checkRateLimit(`user:${profile.id}`, "search_fantasy_players", 30, 60);
  if (!rateLimit.ok) return { error: rateLimit.error, players: [] };

  const supabase = createServerSupabaseClient();
  let request = supabase
    .from("players")
    .select("id, full_name, known_as, position, current_team_id, team:teams(id, name, short_name, crest_url)")
    .order("full_name", { ascending: true });

  const trimmed = query.trim();
  if (trimmed) request = request.ilike("full_name", `%${escapeLikePattern(trimmed)}%`);

  // Mirrors positionGroup()'s free-text classification in fantasy-rules.ts
  // exactly, so the DB-level filter and the client-facing group never drift.
  // Applied before `.limit(60)` below — filtering by position in JS after
  // the limit only searches whichever players of that position happened to
  // fall in the first 60 alphabetical names, which makes the picker
  // unusable for any position at real squad/database size.
  if (position !== "All") {
    const POSITION_FILTERS: Record<PositionGroup, string> = {
      Goalkeepers: "position.ilike.%keeper%,position.ilike.gk",
      Defenders: "position.ilike.%back%,position.ilike.%defen%,position.ilike.df",
      Midfielders: "position.ilike.%mid%,position.ilike.mf",
      Forwards:
        "position.ilike.%forward%,position.ilike.%striker%,position.ilike.%wing%,position.ilike.fw,position.ilike.st",
    };
    request = request.or(POSITION_FILTERS[position]);
  }

  const { data: players, error } = await request.limit(60);
  if (error) {
    logError("fantasy.searchPlayers", error);
    return { error: "Couldn't load players. Try again.", players: [] };
  }

  const filtered = (players ?? []).filter((p) => position === "All" || positionGroup(p.position) === position);
  const playerIds = filtered.map((p) => p.id);

  await ensureFantasyPlayerPrices(seasonId, playerIds);
  const { data: prices } =
    playerIds.length > 0
      ? await supabase.from("fantasy_player_prices").select("player_id, price").eq("season_id", seasonId).in("player_id", playerIds)
      : { data: [] as { player_id: string; price: number }[] };
  const priceMap = new Map((prices ?? []).map((p) => [p.player_id, p.price]));

  const results = filtered
    .map((p) => ({
      id: p.id,
      name: p.known_as ?? p.full_name,
      position: p.position,
      positionGroup: positionGroup(p.position),
      teamName: p.team?.short_name ?? p.team?.name ?? null,
      teamCrestUrl: p.team?.crest_url ?? null,
      price: priceMap.get(p.id) ?? DEFAULT_FANTASY_PRICE,
    }))
    .sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));

  return { error: null, players: results };
}

export type PublicFantasyLeagueListItem = {
  id: string;
  name: string;
  seasonId: string;
  seasonLabel: string;
  maxTeams: number;
  teamCount: number;
  isFull: boolean;
};

/**
 * Browse surface for public leagues (RECOMMENDATIONS item 43). Goes through
 * list_public_fantasy_leagues rather than a plain `.from("fantasy_leagues")`
 * select — fantasy_leagues is owner-only RLS (fantasy_leagues_all_own), so a
 * base-table query can never see another creator's league, public or not.
 * Requests PAGE_SIZE + 1 rows so `hasMore` can be read directly off the
 * response, same trick loadMoreLeagues (src/app/(app)/leagues/actions.ts)
 * uses.
 */
export async function listPublicFantasyLeagues(
  search: string,
  offset: number,
): Promise<{ error: string | null; leagues: PublicFantasyLeagueListItem[]; hasMore: boolean }> {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in.", leagues: [], hasMore: false };

  const trimmed = search.trim();
  const searchPattern = trimmed ? `%${escapeLikePattern(trimmed)}%` : undefined;

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.rpc("list_public_fantasy_leagues", {
    p_search_pattern: searchPattern,
    p_limit: PUBLIC_FANTASY_LEAGUES_PAGE_SIZE + 1,
    p_offset: offset,
  });

  if (error) {
    logError("fantasy.listPublicLeagues", error);
    return { error: "Couldn't load public leagues. Try again.", leagues: [], hasMore: false };
  }

  const rows = data ?? [];
  const leagues = rows.slice(0, PUBLIC_FANTASY_LEAGUES_PAGE_SIZE).map((row) => ({
    id: row.id,
    name: row.name,
    seasonId: row.season_id,
    seasonLabel: [row.competition_short_name ?? row.competition_name, row.season_name].filter(Boolean).join(" · ") || row.season_name,
    maxTeams: row.max_teams,
    teamCount: Number(row.team_count),
    isFull: Number(row.team_count) >= row.max_teams,
  }));

  return { error: null, leagues, hasMore: rows.length > PUBLIC_FANTASY_LEAGUES_PAGE_SIZE };
}

/**
 * Joins a public league with no invite code, the discovery counterpart to
 * joinFantasyLeague above (RECOMMENDATIONS item 43). join_public_fantasy_league
 * re-checks is_private = false itself server-side, so this can't be used to
 * slip into a private league even if its id were somehow known — the code
 * requirement for private leagues is enforced in the RPC, not just by what
 * this page happens to show.
 */
export async function joinPublicFantasyLeague(leagueId: string) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in to join a league." };

  // Same bucket as joinFantasyLeague — both create a fantasy_teams row via
  // the same kind of RPC call, so they share one abuse budget.
  const rateLimit = await checkRateLimit(`user:${profile.id}`, "join_fantasy_league", 5, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.rpc("join_public_fantasy_league", { p_league_id: leagueId });

  if (error) {
    return { error: error.message || "Couldn't join that league. Try again." };
  }

  await awardBadge(profile.id, "fantasy_league_joined");

  revalidatePath("/fantasy");
  revalidatePath("/fantasy/browse");
  return { error: null };
}
