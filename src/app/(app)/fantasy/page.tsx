import type { Metadata } from "next";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { carryForwardFantasyRoster, ensureFantasyPlayerPrices, getFantasyPriceMap } from "@/lib/fantasy";
import { canManageFootballData } from "@/lib/admin";
import { generateFantasyGameweeks } from "@/app/admin/data-health/fantasy-actions";
import { InlineSyncButton } from "@/components/admin/inline-sync-button";
import { FadeIn } from "@/components/ui/fade-in";
import { DEFAULT_FANTASY_PRICE, positionGroup } from "./fantasy-rules";
import { FantasyOnboarding } from "./fantasy-onboarding";
import { FantasyBuilder } from "./fantasy-builder";

export const metadata: Metadata = { title: "Fantasy" };

export default async function FantasyPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}) {
  const { team: teamIdParam } = await searchParams;
  const profile = await getOrCreateProfile();

  if (!profile) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 px-6 py-24 text-center">
        <p className="text-sm text-foreground-muted">Sign up to build your fantasy squad.</p>
        <Link
          href="/sign-up"
          className="kivo-gradient-prime rounded-xl px-5 py-2.5 text-sm font-semibold text-on-accent kivo-raise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Sign up
        </Link>
      </div>
    );
  }

  const supabase = createServerSupabaseClient();

  const [{ data: teams }, { data: currentSeasons }] = await Promise.all([
    supabase
      .from("fantasy_teams")
      .select("id, name")
      .eq("owner_profile_id", profile.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("seasons")
      .select("id, name, competition:competitions(name, short_name)")
      .eq("is_current", true)
      .order("name", { ascending: true }),
  ]);

  const seasonOptions = (currentSeasons ?? []).map((s) => ({
    id: s.id,
    label: [s.competition?.short_name ?? s.competition?.name, s.name].filter(Boolean).join(" · ") || s.name,
  }));

  if (!teams || teams.length === 0) {
    return <FantasyOnboarding availableSeasons={seasonOptions} />;
  }

  const activeTeam = teams.find((t) => t.id === teamIdParam) ?? teams[0];

  // fantasy_leagues is owner-only RLS (see the get_fantasy_team_league
  // migration comment) — a joined-but-non-creator member can't read their
  // league row via a plain join, so this always goes through the
  // ownership-checked RPC instead, for creators and joiners alike.
  const { data: leagueRows, error: leagueError } = await supabase.rpc("get_fantasy_team_league", {
    p_team_id: activeTeam.id,
  });
  const league = leagueRows?.[0] ?? null;

  if (leagueError || !league) {
    return <FantasyOnboarding availableSeasons={seasonOptions} />;
  }

  // fantasy_teams/fantasy_points/profiles are all owner-only RLS, so a plain
  // client select can never see a teammate's row — this goes through the same
  // ownership-checked RPC shape as get_fantasy_team_league above (see the
  // get_fantasy_league_leaderboard migration comment). Batched alongside the
  // real points-history read below (RECOMMENDATIONS.md item 295) since
  // neither depends on the other, both only need activeTeam.id.
  const [{ data: leaderboardRows }, { data: pointsHistoryRows }] = await Promise.all([
    supabase.rpc("get_fantasy_league_leaderboard", { p_team_id: activeTeam.id }),
    // fantasy_points_select_own already scopes this to the caller's own
    // team's rows — no RPC needed, unlike the leaderboard above (which has
    // to read every team in the league, not just the viewer's own).
    supabase
      .from("fantasy_points")
      .select("points, gameweek:fantasy_gameweeks(number)")
      .eq("fantasy_team_id", activeTeam.id),
  ]);
  const leaderboard = {
    entries: (leaderboardRows ?? []).map((row) => ({
      teamId: row.team_id,
      teamName: row.team_name,
      ownerUsername: row.owner_username,
      totalPoints: row.total_points,
      hasScores: row.has_scores,
    })),
    hasAnyScores: (leaderboardRows ?? []).some((row) => row.has_scores),
  };

  // RECOMMENDATIONS.md item 295: a real gameweek-by-gameweek arc, not just
  // the single current-gameweek number or the leaderboard's cumulative
  // total — every scored gameweek already has a real fantasy_points row
  // (written by scoreFantasyGameweek), this is purely a new read of it.
  // Sorted client-side by the joined gameweek number rather than relying on
  // the query builder's cross-table ordering support.
  const pointsHistory = (pointsHistoryRows ?? [])
    .filter((row): row is typeof row & { gameweek: { number: number } } => row.gameweek !== null)
    .map((row) => ({ gameweekNumber: row.gameweek.number, points: row.points }))
    .sort((a, b) => a.gameweekNumber - b.gameweekNumber);

  const { data: gameweek } = await supabase
    .from("fantasy_gameweeks")
    .select("id, number, deadline_at, is_current")
    .eq("season_id", league.season_id)
    .eq("is_current", true)
    .maybeSingle();

  let initialRoster: {
    playerId: string;
    name: string;
    position: string | null;
    positionGroup: ReturnType<typeof positionGroup>;
    teamName: string | null;
    teamCrestUrl: string | null;
    price: number;
    isStarting: boolean;
    isCaptain: boolean;
    isViceCaptain: boolean;
  }[] = [];
  let points: number | null = null;
  let pointsAvailable = false;
  let carriedForwardFromGameweek: number | null = null;

  // Shared shape between the initial load and the re-fetch after a lazy
  // carry-forward insert (see below) — kept as one query so the two never
  // drift out of sync with each other.
  const ROSTER_SELECT = `player_id, is_starting, is_captain, is_vice_captain,
         player:players(id, full_name, known_as, position, current_team_id, team:teams(id, name, short_name, crest_url))`;

  if (gameweek) {
    let { data: roster } = await supabase
      .from("fantasy_rosters")
      .select(ROSTER_SELECT)
      .eq("fantasy_team_id", activeTeam.id)
      .eq("gameweek_id", gameweek.id);

    // A new gameweek starts with zero roster rows for every team — carry the
    // team's most recent earlier squad forward instead of showing an empty
    // pitch that has to be rebuilt from scratch (see carryForwardFantasyRoster
    // for the idempotency + eligibility reasoning). Only attempted when this
    // team genuinely has nothing yet for this gameweek, so a team that has
    // already built (or edited) its own squad here is never touched.
    if (!roster || roster.length === 0) {
      const carry = await carryForwardFantasyRoster(activeTeam.id, league.season_id, gameweek.id, gameweek.number);
      if (carry.carriedFromGameweekNumber !== null) {
        carriedForwardFromGameweek = carry.carriedFromGameweekNumber;
        const { data: refetched } = await supabase
          .from("fantasy_rosters")
          .select(ROSTER_SELECT)
          .eq("fantasy_team_id", activeTeam.id)
          .eq("gameweek_id", gameweek.id);
        roster = refetched;
      }
    }

    const rosterPlayerIds = (roster ?? []).map((r) => r.player_id);
    if (rosterPlayerIds.length > 0) await ensureFantasyPlayerPrices(league.season_id, rosterPlayerIds);
    const priceMap = await getFantasyPriceMap(league.season_id, rosterPlayerIds);

    initialRoster = (roster ?? []).map((r) => ({
      playerId: r.player_id,
      name: r.player?.known_as ?? r.player?.full_name ?? "Unknown player",
      position: r.player?.position ?? null,
      positionGroup: positionGroup(r.player?.position ?? null),
      teamName: r.player?.team?.short_name ?? r.player?.team?.name ?? null,
      teamCrestUrl: r.player?.team?.crest_url ?? null,
      price: priceMap.get(r.player_id) ?? DEFAULT_FANTASY_PRICE,
      isStarting: r.is_starting,
      isCaptain: r.is_captain,
      isViceCaptain: r.is_vice_captain,
    }));

    // fantasy_points is populated by an admin-triggered scoring pass
    // (scoreFantasyGameweek, src/app/admin/data-health/fantasy-actions.ts)
    // that only writes a row once this gameweek has at least one finished
    // fixture — an absent row means "not scored yet", not zero.
    const { data: pointsRow } = await supabase
      .from("fantasy_points")
      .select("points")
      .eq("fantasy_team_id", activeTeam.id)
      .eq("gameweek_id", gameweek.id)
      .maybeSingle();
    points = pointsRow?.points ?? null;
    pointsAvailable = points !== null;
  }

  // FantasyBuilder's own "No gameweek is open yet" empty state is honest but
  // gives an admin no way forward — this banner is the only thing that can
  // actually fix it, shown above the builder rather than inside it so it
  // doesn't touch that component's own render logic.
  const showGenerateGameweeks = !gameweek && canManageFootballData(profile.role);

  return (
    // RECOMMENDATIONS.md item 271: this route's real Promise.all-batched
    // fetch above resolves behind fantasy/loading.tsx's skeleton — FadeIn so
    // the squad builder (and its Leaderboard tab, FantasyLeaderboard) cross-
    // dissolves in rather than hard-cutting from shimmer to content.
    <FadeIn className="flex flex-col gap-3">
      {showGenerateGameweeks && (
        <div className="kivo-glass mx-auto flex w-full max-w-2xl items-center justify-between gap-3 rounded-2xl p-4">
          <p className="text-xs text-foreground-subtle">
            No gameweek is open for this season yet. Generate gameweeks from the season&apos;s synced fixtures.
          </p>
          <InlineSyncButton label="Generate gameweeks" action={generateFantasyGameweeks.bind(null, league.season_id)} />
        </div>
      )}
      <FantasyBuilder
        teams={teams.map((t) => ({ id: t.id, name: t.name }))}
        activeTeamId={activeTeam.id}
        league={{
          id: league.league_id,
          name: league.league_name,
          isPrivate: league.is_private,
          inviteCode: league.invite_code,
          maxTeams: league.max_teams,
          teamCount: league.team_count,
          seasonId: league.season_id,
        }}
        gameweek={gameweek ? { id: gameweek.id, number: gameweek.number, deadlineAt: gameweek.deadline_at } : null}
        initialRoster={initialRoster}
        points={points}
        pointsAvailable={pointsAvailable}
        leaderboard={leaderboard}
        pointsHistory={pointsHistory}
        carriedForwardFromGameweek={carriedForwardFromGameweek}
      />
    </FadeIn>
  );
}
