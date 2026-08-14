"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { getOrCreateFantasyTeam, ensureFantasyPlayerPrices } from "@/lib/fantasy";
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
      revalidatePath("/fantasy");
      return { error: null, leagueId: league.id };
    }

    if (error?.code === "23505") continue; // invite_code collision — retry with a fresh code
    console.error("Failed to create fantasy league", error);
    return { error: "Couldn't create your league. Try again.", leagueId: null };
  }

  return { error: "Couldn't generate a unique invite code. Try again.", leagueId: null };
}

export async function joinFantasyLeague(inviteCode: string) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in to join a league." };

  const code = inviteCode.trim().toUpperCase();
  if (!code) return { error: "Enter an invite code." };

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.rpc("redeem_invite_code", { p_invite_code: code });

  if (error) {
    // redeem_invite_code raises plain, user-safe messages by design — pass
    // them straight through instead of a generic fallback.
    return { error: error.message || "Couldn't join that league. Try again." };
  }

  revalidatePath("/fantasy");
  return { error: null };
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

  const { data: players } = await supabase.from("players").select("id, position").in("id", playerIds);
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

  const captainId = existingRoster?.find((r) => r.is_captain)?.player_id;
  const viceCaptainId = existingRoster?.find((r) => r.is_vice_captain)?.player_id;
  const existingIds = new Set((existingRoster ?? []).map((r) => r.player_id));
  const newIds = new Set(playerIds);
  const toRemove = [...existingIds].filter((id) => !newIds.has(id));

  if (toRemove.length > 0) {
    const { error: removeError } = await supabase
      .from("fantasy_rosters")
      .delete()
      .eq("fantasy_team_id", fantasyTeamId)
      .eq("gameweek_id", gameweekId)
      .in("player_id", toRemove);
    if (removeError) {
      console.error("Failed to remove dropped fantasy roster picks", removeError);
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

  const { error: upsertError } = await supabase
    .from("fantasy_rosters")
    .upsert(rows, { onConflict: "fantasy_team_id,gameweek_id,player_id" });

  if (upsertError) {
    console.error("Failed to save fantasy roster", upsertError);
    return { error: "Couldn't save your squad. Try again." };
  }

  revalidatePath("/fantasy");
  return { error: null };
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
  if (holderIds.length > 0) {
    const { error: clearError } = isCaptainRole
      ? await supabase.from("fantasy_rosters").update({ is_captain: false }).in("id", holderIds)
      : await supabase.from("fantasy_rosters").update({ is_vice_captain: false }).in("id", holderIds);
    if (clearError) {
      console.error("Failed to clear previous fantasy captain", clearError);
      return { error: "Couldn't update captaincy. Try again." };
    }
  }

  const { error: setError } = isCaptainRole
    ? await supabase.from("fantasy_rosters").update({ is_captain: true }).eq("id", target.id)
    : await supabase.from("fantasy_rosters").update({ is_vice_captain: true }).eq("id", target.id);
  if (setError) {
    console.error("Failed to set fantasy captain", setError);
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

  const supabase = createServerSupabaseClient();
  let request = supabase
    .from("players")
    .select("id, full_name, known_as, position, current_team_id, team:teams(id, name, short_name, crest_url)")
    .order("full_name", { ascending: true })
    .limit(60);

  const trimmed = query.trim();
  if (trimmed) request = request.ilike("full_name", `%${trimmed}%`);

  const { data: players, error } = await request;
  if (error) {
    console.error("Failed to search players", error);
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
