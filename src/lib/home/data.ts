import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getMatchRoomActivity } from "@/lib/football/match-room-activity";
import { computeStreaks } from "@/lib/predictions";
import { formatDate } from "@/lib/format";
import { logError } from "@/lib/log";

type Client = SupabaseClient<Database>;

/**
 * The reads behind /home's personal sections.
 *
 * Split out of `home/page.tsx` because that file was already carrying the
 * fixture queries for the lead ladder and adding six more inline would have
 * made the one page nobody can afford to break unreadable. Every function
 * here follows the same two rules as the rest of Home:
 *
 *   - **It returns null/empty rather than a zero.** "No fantasy team" and "a
 *     team with no scored gameweek" are different answers, and the callers can
 *     tell them apart. Nothing here defaults a count to 0 to keep a shape.
 *   - **A failure is not fatal.** These are sections, not the page. Each
 *     loader logs and degrades to "nothing to show" — Home renders without
 *     that section rather than erroring, because a fan opening the app during
 *     a partial outage should still see the football.
 */

/* ------------------------------------------------------------------ */
/* Followed players                                                     */
/* ------------------------------------------------------------------ */

export type FollowedPlayer = {
  id: string;
  name: string;
  position: string | null;
  photoUrl: string | null;
  teamName: string | null;
  teamCrestUrl: string | null;
  /** Their current club's next scheduled kickoff, when KIVO has one. Null is
   * common and renders as nothing rather than as "no fixtures". */
  nextFixture: { id: string; kickoffAt: string; opponentName: string } | null;
};

/**
 * The players this viewer follows, with their club's next fixture attached.
 *
 * `follows.followed_id` is polymorphic (team/player/competition) with no FK,
 * which is why this is two steps rather than a join — the same two-step the
 * followed-clubs query on Home already does.
 */
export async function loadFollowedPlayers(
  supabase: Client,
  profileId: string,
  limit: number,
): Promise<FollowedPlayer[]> {
  try {
    const { data: follows } = await supabase
      .from("follows")
      .select("followed_id")
      .eq("follower_profile_id", profileId)
      .eq("followed_type", "player")
      .limit(limit);

    const playerIds = (follows ?? []).map((row) => row.followed_id);
    if (playerIds.length === 0) return [];

    const { data: players } = await supabase
      .from("players")
      .select(
        `id, full_name, known_as, position, photo_url, current_team_id,
         team:teams!players_current_team_id_fkey(name, crest_url)`,
      )
      .in("id", playerIds);

    const rows = (players ?? []) as unknown as {
      id: string;
      full_name: string;
      known_as: string | null;
      position: string | null;
      photo_url: string | null;
      current_team_id: string | null;
      team: { name: string; crest_url: string | null } | null;
    }[];

    const teamIds = [...new Set(rows.map((row) => row.current_team_id).filter((id): id is string => !!id))];

    // One query for every club's next fixture rather than one per player —
    // several followed players routinely share a club.
    const nextByTeam = new Map<string, { id: string; kickoffAt: string; homeName: string; awayName: string; homeId: string }>();
    if (teamIds.length > 0) {
      const nowIso = new Date().toISOString();
      const { data: fixtures } = await supabase
        .from("fixtures")
        .select(
          `id, kickoff_at, home_team_id, away_team_id,
           home_team:teams!fixtures_home_team_id_fkey(name),
           away_team:teams!fixtures_away_team_id_fkey(name)`,
        )
        .eq("status", "scheduled")
        .gt("kickoff_at", nowIso)
        .or(`home_team_id.in.(${teamIds.join(",")}),away_team_id.in.(${teamIds.join(",")})`)
        .order("kickoff_at", { ascending: true })
        .limit(teamIds.length * 3);

      for (const fixture of (fixtures ?? []) as unknown as {
        id: string;
        kickoff_at: string;
        home_team_id: string;
        away_team_id: string;
        home_team: { name: string } | null;
        away_team: { name: string } | null;
      }[]) {
        for (const teamId of [fixture.home_team_id, fixture.away_team_id]) {
          if (!teamIds.includes(teamId) || nextByTeam.has(teamId)) continue;
          nextByTeam.set(teamId, {
            id: fixture.id,
            kickoffAt: fixture.kickoff_at,
            homeName: fixture.home_team?.name ?? "Home",
            awayName: fixture.away_team?.name ?? "Away",
            homeId: fixture.home_team_id,
          });
        }
      }
    }

    return rows.map((row) => {
      const next = row.current_team_id ? nextByTeam.get(row.current_team_id) : undefined;
      return {
        id: row.id,
        name: row.known_as ?? row.full_name,
        position: row.position,
        photoUrl: row.photo_url,
        teamName: row.team?.name ?? null,
        teamCrestUrl: row.team?.crest_url ?? null,
        nextFixture: next
          ? {
              id: next.id,
              kickoffAt: next.kickoffAt,
              opponentName: next.homeId === row.current_team_id ? next.awayName : next.homeName,
            }
          : null,
      };
    });
  } catch (error) {
    logError("home.data.loadFollowedPlayers", error);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Trending Match Rooms                                                 */
/* ------------------------------------------------------------------ */

export type TrendingRoom = {
  fixtureId: string;
  homeName: string;
  awayName: string;
  homeCrestUrl: string | null;
  awayCrestUrl: string | null;
  isLive: boolean;
  participantCount: number;
  involvesFollowedClub: boolean;
};

/**
 * The busiest Match Rooms among a set of fixtures.
 *
 * "Trending" here is a count of distinct real people who posted, from
 * `get_match_room_activity` — not a score, not a velocity, not anything
 * KIVO would have to defend. A Room with one participant is excluded: one
 * person talking is not a trend, and rounding it up to one would be the first
 * step toward fabricated engagement.
 */
export const MIN_TRENDING_PARTICIPANTS = 2;

export async function loadTrendingRooms(
  supabase: Client,
  fixtures: {
    id: string;
    status: string;
    home_team_id: string;
    away_team_id: string;
    home_team: { name: string; crest_url: string | null } | null;
    away_team: { name: string; crest_url: string | null } | null;
  }[],
  followedTeamIds: Set<string>,
  limit: number,
): Promise<TrendingRoom[]> {
  if (fixtures.length === 0) return [];
  try {
    const activity = await getMatchRoomActivity(
      supabase,
      fixtures.map((fixture) => fixture.id),
    );

    return fixtures
      .map((fixture) => {
        const stats = activity.get(fixture.id);
        if (!stats || stats.participantCount < MIN_TRENDING_PARTICIPANTS) return null;
        return {
          fixtureId: fixture.id,
          homeName: fixture.home_team?.name ?? "Home",
          awayName: fixture.away_team?.name ?? "Away",
          homeCrestUrl: fixture.home_team?.crest_url ?? null,
          awayCrestUrl: fixture.away_team?.crest_url ?? null,
          isLive: fixture.status === "live" || fixture.status === "halftime",
          participantCount: stats.participantCount,
          involvesFollowedClub:
            followedTeamIds.has(fixture.home_team_id) || followedTeamIds.has(fixture.away_team_id),
        } satisfies TrendingRoom;
      })
      .filter((room): room is TrendingRoom => room !== null)
      .sort((a, b) => b.participantCount - a.participantCount)
      .slice(0, limit);
  } catch (error) {
    logError("home.data.loadTrendingRooms", error);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Transfer pulse                                                       */
/* ------------------------------------------------------------------ */

export type PulseTransfer = {
  id: string;
  playerName: string;
  playerId: string;
  fromTeamName: string | null;
  toTeamName: string | null;
  toTeamCrestUrl: string | null;
  typeKey: Database["public"]["Enums"]["transfer_type"];
  feeText: string | null;
  transferDate: string;
  dateLabel: string;
};

/**
 * Completed moves involving a club or player this viewer follows.
 *
 * Every row is a recorded, already-completed transfer — the only kind KIVO
 * has. There is deliberately no rumour tier here and no "linked with"
 * anything: RECOMMENDATIONS.md item 178 retired that taxonomy because the
 * provider returns completed moves only, so any other label would be invented.
 * "Pulse" is about recency, not about speculation.
 */
export async function loadTransferPulse(
  supabase: Client,
  followedTeamIds: string[],
  followedPlayerIds: string[],
  limit: number,
): Promise<PulseTransfer[]> {
  if (followedTeamIds.length === 0 && followedPlayerIds.length === 0) return [];
  try {
    const filters: string[] = [];
    if (followedTeamIds.length > 0) {
      filters.push(`from_team_id.in.(${followedTeamIds.join(",")})`, `to_team_id.in.(${followedTeamIds.join(",")})`);
    }
    if (followedPlayerIds.length > 0) {
      filters.push(`player_id.in.(${followedPlayerIds.join(",")})`);
    }

    const { data } = await supabase
      .from("transfers")
      .select(
        `id, transfer_date, fee_text, transfer_type, player_id,
         player:players(full_name, known_as),
         from_team:teams!transfers_from_team_id_fkey(name),
         to_team:teams!transfers_to_team_id_fkey(name, crest_url)`,
      )
      .or(filters.join(","))
      .order("transfer_date", { ascending: false })
      .limit(limit);

    return ((data ?? []) as unknown as {
      id: string;
      transfer_date: string;
      fee_text: string | null;
      transfer_type: Database["public"]["Enums"]["transfer_type"];
      player_id: string;
      player: { full_name: string; known_as: string | null } | null;
      from_team: { name: string } | null;
      to_team: { name: string; crest_url: string | null } | null;
    }[])
      .filter((row) => row.player)
      .map((row) => ({
        id: row.id,
        playerId: row.player_id,
        playerName: row.player?.known_as ?? row.player?.full_name ?? "",
        fromTeamName: row.from_team?.name ?? null,
        toTeamName: row.to_team?.name ?? null,
        toTeamCrestUrl: row.to_team?.crest_url ?? null,
        typeKey: row.transfer_type,
        feeText: row.fee_text,
        transferDate: row.transfer_date,
        dateLabel: formatDate(row.transfer_date, { month: "short" }),
      }));
  } catch (error) {
    logError("home.data.loadTransferPulse", error);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Fantasy summary                                                      */
/* ------------------------------------------------------------------ */

export type FantasySummary = {
  teamId: string;
  teamName: string;
  leagueName: string | null;
  /** Null until a gameweek has genuinely been scored. Never 0 as a stand-in. */
  latestPoints: number | null;
  latestGameweekNumber: number | null;
  /** Null unless the league leaderboard actually has scores to rank by. */
  rank: number | null;
  entriesRanked: number | null;
};

/**
 * This viewer's fantasy standing, read straight from the fantasy tables.
 *
 * Deliberately queries the schema rather than importing anything from
 * `src/app/(app)/fantasy/*`: that area is being rebuilt by another agent, and
 * Home must not be coupled to a surface in motion. The two shapes this relies
 * on are `fantasy_points(fantasy_team_id, gameweek_id, points)` and the
 * `get_fantasy_league_leaderboard(p_team_id)` RPC — if the rebuild changes
 * either, this is the one place that needs updating.
 */
export async function loadFantasySummary(
  supabase: Client,
  fantasyTeamIds: string[],
): Promise<FantasySummary | null> {
  const teamId = fantasyTeamIds[0];
  if (!teamId) return null;

  try {
    const { data: teamRow } = await supabase
      .from("fantasy_teams")
      .select("id, name, league:fantasy_leagues!fantasy_teams_league_id_fkey(name)")
      .eq("id", teamId)
      .maybeSingle();
    if (!teamRow) return null;

    const [{ data: latest }, { data: leaderboard }] = await Promise.all([
      supabase
        .from("fantasy_points")
        .select("points, gameweek:fantasy_gameweeks(number)")
        .eq("fantasy_team_id", teamId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.rpc("get_fantasy_league_leaderboard", { p_team_id: teamId }),
    ]);

    const scored = latest as unknown as { points: number; gameweek: { number: number } | null } | null;

    // Only teams the leaderboard says actually have scores can be ranked. A
    // league where nobody has been scored yet produces no rank at all rather
    // than an alphabetical "1st".
    const ranked = ((leaderboard ?? []) as { team_id: string; has_scores: boolean }[]).filter((row) => row.has_scores);
    const rankIndex = ranked.findIndex((row) => row.team_id === teamId);

    const league = teamRow.league as unknown as { name: string } | null;

    return {
      teamId,
      teamName: teamRow.name,
      leagueName: league?.name ?? null,
      latestPoints: scored ? scored.points : null,
      latestGameweekNumber: scored?.gameweek?.number ?? null,
      rank: rankIndex >= 0 ? rankIndex + 1 : null,
      entriesRanked: rankIndex >= 0 ? ranked.length : null,
    };
  } catch (error) {
    logError("home.data.loadFantasySummary", error);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Prediction summary                                                   */
/* ------------------------------------------------------------------ */

export type PredictionSummary = {
  openCount: number;
  /** When the soonest open call locks — the fixture's own kickoff. Null when
   * nothing is open or no kickoff is known. */
  nextLockAt: string | null;
  currentStreak: number;
  bestStreak: number;
  scoredCount: number;
  correctCount: number;
};

/**
 * Everything Home says about predictions, in one read.
 *
 * Returns null for a viewer who has never made a prediction — which is
 * different from one with none open, and the difference decides whether the
 * section exists at all. Streaks come from `computeStreaks`, the same function
 * /predictions/mine and the badge criteria use, so Home can never disagree
 * with either about what a run is.
 */
export async function loadPredictionSummary(
  supabase: Client,
  profileId: string,
): Promise<PredictionSummary | null> {
  try {
    const { data: rows } = await supabase
      .from("predictions")
      .select("points_awarded, locked_at, fixture:fixtures(kickoff_at)")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(200);

    const predictions = (rows ?? []) as unknown as {
      points_awarded: number | null;
      locked_at: string | null;
      fixture: { kickoff_at: string } | null;
    }[];

    if (predictions.length === 0) return null;

    const open = predictions.filter((row) => row.locked_at === null);
    const scored = predictions.filter((row) => row.points_awarded !== null && row.fixture);

    const nextLockAt =
      open
        .map((row) => row.fixture?.kickoff_at)
        .filter((iso): iso is string => !!iso)
        .sort()[0] ?? null;

    const streaks = computeStreaks(
      scored.map((row) => ({
        pointsAwarded: row.points_awarded as number,
        kickoffAt: row.fixture?.kickoff_at as string,
      })),
    );

    return {
      openCount: open.length,
      nextLockAt,
      currentStreak: streaks.current,
      bestStreak: streaks.best,
      scoredCount: scored.length,
      correctCount: scored.filter((row) => (row.points_awarded ?? 0) > 0).length,
    };
  } catch (error) {
    logError("home.data.loadPredictionSummary", error);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Followed competitions                                                */
/* ------------------------------------------------------------------ */

export type FollowedCompetition = {
  id: string;
  name: string;
  country: string | null;
  logoUrl: string | null;
  /** Fixtures on this competition's card inside the viewer's own day. Zero is
   * a genuinely counted zero here — the query asks the whole competition, not
   * a sampled window — and renders as no line rather than "0 today". */
  todayCount: number;
};

/**
 * The competitions this viewer follows.
 *
 * Until this pass a competition follow had no consumer on /home at all — the
 * follow query filtered `followed_type` down to team and player, so a fan who
 * had starred the Premier League on /matches saw no trace of it on the screen
 * the app opens on. `src/lib/follow-meaning.ts` describes a competition follow
 * as a bookmark; this is that bookmark reaching the place bookmarks are for.
 *
 * The count is a real `head: true` count per competition inside the viewer's
 * own day window, not a tally of the fixtures some other section happened to
 * fetch — a sampled window would under-report on a busy Saturday, and a home
 * screen that quietly under-reports a matchday is worse than one that says
 * nothing.
 */
export async function loadFollowedCompetitions(
  supabase: Client,
  profileId: string,
  dayStart: Date,
  dayEnd: Date,
  limit: number,
): Promise<FollowedCompetition[]> {
  try {
    const { data: follows } = await supabase
      .from("follows")
      .select("followed_id")
      .eq("follower_profile_id", profileId)
      .eq("followed_type", "competition")
      .limit(limit);

    const ids = (follows ?? []).map((row) => row.followed_id);
    if (ids.length === 0) return [];

    const { data: competitions } = await supabase
      .from("competitions")
      .select("id, name, country, logo_url")
      .in("id", ids);

    if (!competitions || competitions.length === 0) return [];

    const counts = await Promise.all(
      competitions.map(async (competition) => {
        const { count } = await supabase
          .from("fixtures")
          .select("id", { count: "exact", head: true })
          .eq("competition_id", competition.id)
          .gte("kickoff_at", dayStart.toISOString())
          .lt("kickoff_at", dayEnd.toISOString());
        return count ?? 0;
      }),
    );

    return competitions
      .map((competition, index) => ({
        id: competition.id,
        name: competition.name,
        country: competition.country,
        logoUrl: competition.logo_url,
        todayCount: counts[index],
      }))
      // Whatever has football on today comes first; the rest keep their own
      // order, so the rail leads with the one the reader can act on.
      .sort((a, b) => b.todayCount - a.todayCount);
  } catch (error) {
    logError("home.data.loadFollowedCompetitions", error);
    return [];
  }
}
