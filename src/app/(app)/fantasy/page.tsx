import type { Metadata } from "next";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readList } from "@/lib/query-result";
import { LoadFailed } from "@/components/ui/load-failed";
import { getOrCreateProfile } from "@/lib/profile";
import { carryForwardFantasyRoster, ensureFantasyPlayerPrices, getFantasyPriceMap } from "@/lib/fantasy";
import { FadeIn } from "@/components/ui/fade-in";
import { WidgetErrorBoundary } from "@/components/ui/soft-error-boundary";
import { ShareCardPanel } from "@/components/share/share-card-panel";
import { GameweekScorecard } from "./gameweek-scorecard";
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

  const [teamsResult, currentSeasonsResult] = await Promise.all([
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

  const teamsOutcome = readList(teamsResult, "fantasy.myTeams");
  const seasonsOutcome = readList(currentSeasonsResult, "fantasy.currentSeasons");

  // The empty branch of this page is not an empty state — it is FantasyOnboarding,
  // which asks the reader to create a squad. Reaching it on a failed read tells
  // an existing manager they have no team and invites them to start over, which
  // is the single most destructive thing this page could get wrong.
  if (teamsOutcome.failed || seasonsOutcome.failed) {
    return (
      <LoadFailed
        title="Fantasy"
        description="KIVO couldn't read your fantasy squads just now. Nothing has been lost — this page would otherwise ask you to create a team you may already have. Try again."
      />
    );
  }

  const teams = teamsOutcome.rows;
  const seasonOptions = seasonsOutcome.rows.map((s) => ({
    id: s.id,
    label: [s.competition?.short_name ?? s.competition?.name, s.name].filter(Boolean).join(" · ") || s.name,
  }));

  if (teams.length === 0) {
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
      .select("points, gameweek:fantasy_gameweeks(id, number)")
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
  const scoredGameweeks = (pointsHistoryRows ?? [])
    .filter((row): row is typeof row & { gameweek: { id: string; number: number } } => row.gameweek !== null)
    .map((row) => ({ gameweekId: row.gameweek.id, gameweekNumber: row.gameweek.number, points: row.points }))
    .sort((a, b) => a.gameweekNumber - b.gameweekNumber);
  const pointsHistory = scoredGameweeks.map(({ gameweekNumber, points }) => ({ gameweekNumber, points }));

  const { data: gameweek } = await supabase
    .from("fantasy_gameweeks")
    .select("id, number, deadline_at, is_current")
    .eq("season_id", league.season_id)
    .eq("is_current", true)
    .maybeSingle();

  /**
   * Which gameweek the itemised scorecard is about.
   *
   * Not simply the current one. `is_current` is the earliest gameweek whose
   * DEADLINE is still ahead, and a deadline is that gameweek's own first
   * kickoff — so the moment Saturday's football starts, "current" means next
   * week. Binding the scorecard to it meant the breakdown for the gameweek a
   * manager had just watched was never on this page at any point: unscored
   * while it was current, and no longer current once it had been scored.
   *
   * So: the current gameweek when it has a score, and otherwise the most
   * recent gameweek that does. Read from the points rows already loaded above,
   * so this costs nothing extra.
   */
  const latestScored = scoredGameweeks.at(-1) ?? null;
  const scorecardGameweek =
    gameweek && scoredGameweeks.some((row) => row.gameweekId === gameweek.id)
      ? { id: gameweek.id, number: gameweek.number }
      : latestScored
        ? { id: latestScored.gameweekId, number: latestScored.gameweekNumber }
        : null;

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
    const rosterOutcome = readList(
      await supabase
        .from("fantasy_rosters")
        .select(ROSTER_SELECT)
        .eq("fantasy_team_id", activeTeam.id)
        .eq("gameweek_id", gameweek.id),
      "fantasy.roster",
    );

    // Gated before the carry-forward below, and that is the reason rather
    // than a side effect. `!roster || roster.length === 0` used to treat a
    // failed read as "this team has no squad this gameweek", which is the
    // trigger for a *write* — carrying an earlier squad forward on top of one
    // that may already exist. A failed read must never be allowed to start
    // writing.
    if (rosterOutcome.failed) {
      return (
        <LoadFailed
          title="Your squad"
          description="KIVO couldn't read your squad for this gameweek. It hasn't been cleared — try again rather than picking it over."
        />
      );
    }

    let roster: typeof rosterOutcome.rows | null = rosterOutcome.rows;

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
  // ADMIN IA PASS 2026-08-19: a staff-only "Generate gameweeks" card used to
  // render here whenever an admin opened a season with no gameweek open. It was
  // invisible to fans and it was still in the wrong place — the fix for "fantasy
  // has no gameweeks in this season" was reachable only by an admin who first
  // navigated into the broken state as a player. It now lives on
  // /admin/data-health/integrity, listing every current season with its fixture
  // and gameweek counts.

  return (
    // RECOMMENDATIONS.md item 271: this route's real Promise.all-batched
    // fetch above resolves behind fantasy/loading.tsx's skeleton — FadeIn so
    // the squad builder (and its Leaderboard tab, FantasyLeaderboard) cross-
    // dissolves in rather than hard-cutting from shimmer to content.
    <FadeIn className="flex flex-col gap-3">
      <WidgetErrorBoundary context="fantasyBuilder" label="The squad builder">
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
      </WidgetErrorBoundary>

      {/* The itemised score, below the builder because it answers a question
          the builder raises rather than one it asks. Renders nothing at all
          until the gameweek has actually been scored — see the component. */}
      {scorecardGameweek && (
        <WidgetErrorBoundary context="fantasyScorecard" label="Your gameweek scorecard">
          <GameweekScorecard
            fantasyTeamId={activeTeam.id}
            gameweekId={scorecardGameweek.id}
            gameweekNumber={scorecardGameweek.number}
          />
        </WidgetErrorBoundary>
      )}

      {/* Only a gameweek that has actually been scored produces a card — an
          unscored week would render as 0 points, which reads as a bad week
          rather than as "nothing calculated yet". */}
      <div className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
        <ShareCardPanel
          kind="fantasy-performance"
          id={activeTeam.id}
          shareUrl="/fantasy"
          shareText={`${activeTeam.name} on KIVO Fantasy.`}
          heading="Share your gameweek"
          description="Pick a background. The preview is the exact image you save."
        />
      </div>
    </FadeIn>
  );
}
