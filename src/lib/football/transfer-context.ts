import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { computePlayerMatchStats } from "./player-stats";
import { positionGroup, type PositionGroupOrOther } from "@/app/(app)/fantasy/fantasy-rules";
import { logError } from "@/lib/log";

/**
 * The real context around one transfer: the directive's "player fit" and "club
 * need", built only out of rows KIVO actually holds.
 *
 * ## What "fit" and "need" are allowed to mean here
 *
 * Both words normally describe an opinion — a scout's judgement, or a model's
 * output. KIVO has neither, and dressing a guess up as either would be exactly
 * the fabrication this product refuses. What KIVO does have is countable:
 *
 *   - how many players it has synced for the destination club, and how those
 *     break down by position group,
 *   - the destination club's real league line for the current season (played,
 *     goals for, goals against, position),
 *   - the moving player's own real appearance, start, goal and card totals.
 *
 * So this module returns those counts and nothing else. The UI presents them
 * as facts with their sample stated ("KIVO has 24 players synced for Inter"),
 * never as a verdict. A reader can draw the conclusion; KIVO does not draw it
 * for them, because drawing it would require data KIVO does not have.
 *
 * Every field is nullable and every consumer omits its element when null. A
 * club with no synced squad shows no squad section — not a zero.
 */

type Client = SupabaseClient<Database>;

export type SquadShape = {
  teamId: string;
  teamName: string;
  /** How many players KIVO has on file for this club. Stated wherever the
   * breakdown is, because the breakdown is only as complete as this is. */
  knownPlayerCount: number;
  /** Counts per position group, only for groups that actually have players. */
  byPosition: { group: PositionGroupOrOther; count: number }[];
  /** How many of those play the moving player's own position group — the one
   * number that makes the rest of the breakdown worth reading. */
  countInPlayerPosition: number | null;
};

export type ClubLeagueLine = {
  competitionName: string;
  seasonName: string;
  position: number | null;
  played: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
};

export type PlayerRecord = {
  appearances: number;
  starts: number;
  goals: number;
  /** Null only when the caller did not query assist rows; this one always
   * does, so in practice it is a real count. Typed nullable because
   * `PlayerMatchStats` is, and narrowing it here would be a lie by cast. */
  assists: number | null;
  yellowCards: number;
  redCards: number;
};

export type TransferSource = {
  provider: string;
  /** When KIVO last wrote this mapping — the honest answer to "how fresh is
   * this?". It is KIVO's retrieval time, not the provider's publication time,
   * and the UI says so rather than implying the latter. */
  retrievedAt: string;
};

export type TransferTimelineEntry = {
  id: string;
  transferDate: string;
  transferType: Database["public"]["Enums"]["transfer_type"];
  feeText: string | null;
  fromTeamName: string | null;
  toTeamName: string | null;
  /** True for the transfer the page is about, so the timeline can mark where
   * "here" is rather than repeating the header. */
  isCurrent: boolean;
};

export type TransferContext = {
  source: TransferSource | null;
  timeline: TransferTimelineEntry[];
  playerRecord: PlayerRecord | null;
  destinationSquad: SquadShape | null;
  destinationLeagueLine: ClubLeagueLine | null;
};

/**
 * Which provider recorded this move and when KIVO last wrote it. Read from
 * `provider_mappings`, the same table the sync writes — so the attribution is
 * the real one for this row rather than whichever provider happens to be
 * configured right now.
 */
async function loadSource(supabase: Client, transferId: string): Promise<TransferSource | null> {
  const { data } = await supabase
    .from("provider_mappings")
    .select("provider, updated_at")
    .eq("entity_type", "transfer")
    .eq("kivo_entity_id", transferId)
    .maybeSingle();
  if (!data) return null;
  return { provider: data.provider, retrievedAt: data.updated_at };
}

/** Every recorded move for this player, newest first — the directive's
 * "transfer timeline". Real rows only; a player with one move has a timeline
 * of one, which the UI renders as a single point rather than padding it. */
async function loadTimeline(
  supabase: Client,
  playerId: string,
  currentTransferId: string,
): Promise<TransferTimelineEntry[]> {
  const { data } = await supabase
    .from("transfers")
    .select(
      `id, transfer_date, transfer_type, fee_text,
       from_team:teams!transfers_from_team_id_fkey(name),
       to_team:teams!transfers_to_team_id_fkey(name)`,
    )
    .eq("player_id", playerId)
    .order("transfer_date", { ascending: false });

  const rows = (data ?? []) as unknown as {
    id: string;
    transfer_date: string;
    transfer_type: Database["public"]["Enums"]["transfer_type"];
    fee_text: string | null;
    from_team: { name: string } | null;
    to_team: { name: string } | null;
  }[];

  return rows.map((row) => ({
    id: row.id,
    transferDate: row.transfer_date,
    transferType: row.transfer_type,
    feeText: row.fee_text,
    fromTeamName: row.from_team?.name ?? null,
    toTeamName: row.to_team?.name ?? null,
    isCurrent: row.id === currentTransferId,
  }));
}

async function loadPlayerRecord(supabase: Client, playerId: string): Promise<PlayerRecord | null> {
  const [{ data: lineupRows }, { data: eventRows }, { data: assistEventRows }] = await Promise.all([
    supabase.from("lineups").select("is_starting, fixture:fixtures(status)").eq("player_id", playerId),
    supabase.from("fixture_events").select("event_type").eq("player_id", playerId),
    // The assister on a goal, from `related_player_id` — see
    // computePlayerMatchStats for why this and not the per-match stats table.
    supabase.from("fixture_events").select("event_type").eq("related_player_id", playerId),
  ]);

  const lineups = (lineupRows ?? []) as unknown as {
    is_starting: boolean;
    fixture: { status: Database["public"]["Enums"]["fixture_status"] } | null;
  }[];

  // No synced lineups at all means KIVO knows nothing about this player's
  // matches. That is not "zero appearances".
  if (lineups.length === 0) return null;

  return computePlayerMatchStats(
    lineups,
    (eventRows ?? []) as { event_type: Database["public"]["Enums"]["fixture_event_type"] }[],
    (assistEventRows ?? []) as { event_type: Database["public"]["Enums"]["fixture_event_type"] }[],
  );
}

/**
 * The destination club's squad as KIVO holds it, grouped by position.
 *
 * `players.current_team_id` is the club a player is currently mapped to, so
 * this is a snapshot of what has been synced — never a claimed full squad. The
 * count is returned alongside the breakdown precisely so the UI can say how
 * partial it is.
 */
async function loadSquadShape(
  supabase: Client,
  teamId: string,
  teamName: string,
  playerPosition: string | null,
): Promise<SquadShape | null> {
  const { data } = await supabase.from("players").select("position").eq("current_team_id", teamId);
  const rows = data ?? [];
  if (rows.length === 0) return null;

  // `positionGroup` is the same mapper the fantasy squad view uses, including
  // its "Other" bucket for a position string KIVO cannot classify — kept
  // rather than dropped, because a squad breakdown that quietly excludes four
  // players does not add up to the count printed next to it.
  const counts = new Map<PositionGroupOrOther, number>();
  for (const row of rows) {
    const group = positionGroup(row.position);
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }

  const playerGroup = playerPosition ? positionGroup(playerPosition) : null;

  return {
    teamId,
    teamName,
    knownPlayerCount: rows.length,
    byPosition: [...counts.entries()]
      .map(([group, count]) => ({ group, count }))
      .sort((a, b) => b.count - a.count),
    countInPlayerPosition: playerGroup && playerGroup !== "Other" ? (counts.get(playerGroup) ?? 0) : null,
  };
}

/**
 * The destination club's real line in whatever current-season table KIVO has
 * for it. Null when the club has no standings row, which is common and honest
 * — plenty of synced clubs have fixtures and no table.
 */
async function loadLeagueLine(supabase: Client, teamId: string): Promise<ClubLeagueLine | null> {
  const { data } = await supabase
    .from("standings")
    .select(
      `position, played, goals_for, goals_against, points,
       season:seasons(name, is_current, competition:competitions(name))`,
    )
    .eq("team_id", teamId)
    .order("updated_at", { ascending: false })
    .limit(5);

  const rows = (data ?? []) as unknown as {
    position: number | null;
    played: number;
    goals_for: number;
    goals_against: number;
    points: number;
    season: { name: string; is_current: boolean; competition: { name: string } | null } | null;
  }[];

  const row = rows.find((candidate) => candidate.season?.is_current) ?? rows[0];
  if (!row?.season) return null;

  return {
    competitionName: row.season.competition?.name ?? "Competition",
    seasonName: row.season.name,
    position: row.position,
    played: row.played,
    goalsFor: row.goals_for,
    goalsAgainst: row.goals_against,
    points: row.points,
  };
}

export async function loadTransferContext(
  supabase: Client,
  input: {
    transferId: string;
    playerId: string;
    playerPosition: string | null;
    toTeamId: string | null;
    toTeamName: string | null;
  },
): Promise<TransferContext> {
  try {
    const [source, timeline, playerRecord, destinationSquad, destinationLeagueLine] = await Promise.all([
      loadSource(supabase, input.transferId),
      loadTimeline(supabase, input.playerId, input.transferId),
      loadPlayerRecord(supabase, input.playerId),
      input.toTeamId && input.toTeamName
        ? loadSquadShape(supabase, input.toTeamId, input.toTeamName, input.playerPosition)
        : Promise.resolve(null),
      input.toTeamId ? loadLeagueLine(supabase, input.toTeamId) : Promise.resolve(null),
    ]);

    return { source, timeline, playerRecord, destinationSquad, destinationLeagueLine };
  } catch (error) {
    // Context is enrichment. A transfer page must still render the move itself
    // if any of this fails.
    logError("football.transfer-context.load", error);
    return { source: null, timeline: [], playerRecord: null, destinationSquad: null, destinationLeagueLine: null };
  }
}
