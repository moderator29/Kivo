import "server-only";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { DEFAULT_FANTASY_PRICE } from "@/app/(app)/fantasy/fantasy-rules";
import type { Database } from "@/lib/supabase/types";

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
    console.error("Failed to create fantasy team", error);
    return { team: null, error: "Couldn't create your fantasy team. Try again." };
  }

  return { team: created, error: null };
}

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
 */
export async function ensureFantasyPlayerPrices(seasonId: string, playerIds: string[]): Promise<void> {
  const uniqueIds = Array.from(new Set(playerIds));
  if (uniqueIds.length === 0) return;

  const service = createServiceRoleSupabaseClient();
  const rows = uniqueIds.map((playerId) => ({
    player_id: playerId,
    season_id: seasonId,
    price: DEFAULT_FANTASY_PRICE,
  }));

  const { error } = await service
    .from("fantasy_player_prices")
    .upsert(rows, { onConflict: "player_id,season_id", ignoreDuplicates: true });

  if (error) {
    console.error("Failed to backfill fantasy player prices", error);
  }
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
