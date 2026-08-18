import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin, Share2 } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { triggerFixtureDetailsSync } from "@/app/admin/data-health/actions";
import { FadeIn } from "@/components/ui/fade-in";
import { WidgetErrorBoundary } from "@/components/ui/soft-error-boundary";
import { LastSyncedNote } from "@/components/football/last-synced-note";
import { AskAiLink } from "@/components/ai/ask-ai-link";
import { MatchCentreTabs } from "@/components/matches/match-centre-tabs";
import { TeamCrest } from "@/components/ui/team-crest";
import { HeadToHeadCard } from "@/components/football/head-to-head-card";
import { FanRatingCard } from "@/components/matches/fan-rating-card";
import { MatchVerdictCard } from "@/components/matches/match-verdict-card";
import { MatchScoreDisplay } from "@/components/matches/match-score-display";
import { MatchShareCard } from "@/components/matches/match-share-card";
import { YourPredictionCard } from "@/components/matches/your-prediction-card";
import { getLastSyncedAt } from "@/lib/football/last-synced";
import { getHeadToHead } from "@/lib/football/head-to-head";
import { buildMatchShareCardData } from "@/lib/football/match-share-card";
import { getViewerFantasyRosterBySeasons, type ViewerFantasyRosterMap } from "@/lib/football/fantasy-lineup-crossref";
import { fetchPostsPage } from "@/app/(app)/social/posts";
import { absoluteUrl } from "@/lib/site-url";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = createServerSupabaseClient();
  const { data: fixture } = await supabase
    .from("fixtures")
    .select(
      `home_team:teams!fixtures_home_team_id_fkey(name),
       away_team:teams!fixtures_away_team_id_fkey(name)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!fixture?.home_team?.name || !fixture?.away_team?.name) return { title: "Match" };

  const title = `${fixture.home_team.name} vs ${fixture.away_team.name}`;
  const description = `${title}, live on KIVO: score, lineups, and match centre.`;
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { title, description },
  };
}

export default async function MatchCentrePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ post?: string }>;
}) {
  const { id } = await params;
  const { post: targetPostId } = await searchParams;
  const supabase = createServerSupabaseClient();
  const profile = await getOrCreateProfile();

  const { data: fixture } = await supabase
    .from("fixtures")
    .select(
      `id, kickoff_at, status, home_score, away_score, minute_elapsed, season_id,
       home_team:teams!fixtures_home_team_id_fkey(id, name, short_name, crest_url),
       away_team:teams!fixtures_away_team_id_fkey(id, name, short_name, crest_url),
       competition:competitions(name, short_name),
       venue:venues(id, name, city)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!fixture) notFound();

  // RECOMMENDATIONS.md item 170: only meaningful once the match is actually
  // over — fan_ratings_insert_own's own WITH CHECK (0032) enforces this same
  // rule server-side, this just avoids fetching rating data for a fixture
  // nobody could have rated yet.
  const isFinished = fixture.status === "finished";

  const [
    { data: events },
    { data: lineups },
    { data: stats },
    { data: standings },
    { posts: roomPostsPage },
    fixturesLastSyncedAt,
    detailsLastSyncedAt,
    headToHead,
    ownFanRating,
    fanRatingSummary,
    { data: managers },
    { data: ownPrediction },
    viewerFantasyRosterBySeason,
  ] = await Promise.all([
    supabase
      .from("fixture_events")
      .select(
        `id, event_type, minute, added_time, detail, team_id,
         player:players!fixture_events_player_id_fkey(id, full_name, known_as),
         related_player:players!fixture_events_related_player_id_fkey(id, full_name, known_as)`,
      )
      .eq("fixture_id", id)
      .order("minute", { ascending: true }),
    supabase
      .from("lineups")
      .select("team_id, is_starting, shirt_number, position, formation, player:players(id, full_name, known_as)")
      .eq("fixture_id", id),
    supabase
      .from("fixture_statistics")
      .select(
        `team_id, shots_total, shots_on_target, shots_off_target, shots_blocked, shots_inside_box,
         shots_outside_box, fouls, corners, offsides, possession_pct, yellow_cards, red_cards, saves,
         passes_total, passes_accurate, passes_pct, expected_goals`,
      )
      .eq("fixture_id", id),
    supabase
      .from("standings")
      .select("team_id, played, won, drawn, lost, goals_for, goals_against, points, position, team:teams(name, crest_url)")
      .eq("season_id", fixture.season_id)
      .order("position", { ascending: true }),
    // Same shared query as /social and its own "Load more" — just scoped to
    // this fixture's posts. See app/(app)/social/posts.ts.
    fetchPostsPage(0, profile?.id ?? null, { fixtureId: id, limit: 50 }),
    // RECOMMENDATIONS.md item 60: "last synced" freshness for this fixture's core
    // score/status (entity_type 'fixture', written by syncTodayFixtures) and,
    // separately, its lineups/events/stats (entity_type 'lineup', written by
    // syncFixtureDetails) — see getLastSyncedAt() and MatchCentreTabs.
    getLastSyncedAt(["fixture"]),
    getLastSyncedAt(["lineup"]),
    // RECOMMENDATIONS.md item 161: prior meetings only, excluding this very
    // fixture (it's the one already on screen, not "history").
    fixture.home_team?.id && fixture.away_team?.id
      ? getHeadToHead(supabase, fixture.home_team.id, fixture.away_team.id, { excludeFixtureId: fixture.id })
      : Promise.resolve(null),
    // fan_ratings_select_own already scopes this to the caller's own row.
    isFinished && profile
      ? supabase.from("fan_ratings").select("rating").eq("fixture_id", id).eq("profile_id", profile.id).maybeSingle()
      : Promise.resolve({ data: null }),
    // Real aggregate via the narrow SECURITY DEFINER RPC — fan_ratings has no
    // cross-user SELECT policy, same reasoning as get_prediction_consensus.
    isFinished
      ? supabase.rpc("get_fan_rating_summary", { p_fixture_id: id })
      : Promise.resolve({ data: null }),
    // Each team's current manager, already synced by syncTeamSquad/getManager
    // (the `managers` table) — zero new provider calls, just a join against
    // data already in the database, per this task's item 1.
    fixture.home_team?.id && fixture.away_team?.id
      ? supabase
          .from("managers")
          .select("id, full_name, current_team_id, updated_at")
          .in("current_team_id", [fixture.home_team.id, fixture.away_team.id])
          .order("updated_at", { ascending: false })
      : Promise.resolve({ data: null }),
    // RECOMMENDATIONS.md item 293: predictions_select_own already scopes this
    // to the caller's own row — no RLS change, no RPC needed.
    profile
      ? supabase
          .from("predictions")
          .select("predicted_outcome, points_awarded")
          .eq("fixture_id", id)
          .eq("profile_id", profile.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // RECOMMENDATIONS.md item 294: real fantasy_rosters -> lineups player-id
    // cross-reference for LineupsTab's "In your XI" pill — see
    // getViewerFantasyRosterBySeasons' own doc comment for the full join
    // chain. Scoped to just this one fixture's season.
    profile
      ? getViewerFantasyRosterBySeasons(supabase, profile.id, [fixture.season_id])
      : Promise.resolve(new Map<string, ViewerFantasyRosterMap>()),
  ]);

  const viewerFantasyRoster = viewerFantasyRosterBySeason.get(fixture.season_id) ?? new Map();
  const viewerFantasyRosterForTab = [...viewerFantasyRoster.entries()].map(([playerId, flags]) => ({
    playerId,
    isCaptain: flags.isCaptain,
  }));

  // RECOMMENDATIONS item 237: same fix as /social's — a notification's
  // `?post=<id>` link (postHref() in lib/notification-registry.ts) can name
  // a Room post older than the 50 most recently loaded here. Fetch it
  // explicitly and prepend it rather than leaving the client to scroll to an
  // anchor that was never fetched at all.
  let roomPosts = roomPostsPage;
  if (targetPostId && !roomPostsPage.some((p) => p.id === targetPostId)) {
    const { posts: targetPosts } = await fetchPostsPage(0, profile?.id ?? null, { fixtureId: id, postIds: [targetPostId] });
    if (targetPosts.length > 0) roomPosts = [...targetPosts, ...roomPostsPage];
  }

  const statsForTab = (stats ?? []).map((s) => ({
    teamId: s.team_id,
    shotsTotal: s.shots_total,
    shotsOnTarget: s.shots_on_target,
    shotsOffTarget: s.shots_off_target,
    shotsBlocked: s.shots_blocked,
    shotsInsideBox: s.shots_inside_box,
    shotsOutsideBox: s.shots_outside_box,
    fouls: s.fouls,
    corners: s.corners,
    offsides: s.offsides,
    possessionPct: s.possession_pct,
    yellowCards: s.yellow_cards,
    redCards: s.red_cards,
    saves: s.saves,
    passesTotal: s.passes_total,
    passesAccurate: s.passes_accurate,
    passesPct: s.passes_pct,
    expectedGoals: s.expected_goals,
  }));

  const roomPostsForTab = roomPosts.map((post) => ({
    id: post.id,
    body: post.body,
    createdAt: post.createdAt,
    authorName: post.authorName,
    authorAvatarSrc: post.authorAvatarSrc,
    reactionCount: post.reactionCount,
    viewerReaction: post.viewerReaction,
    commentCount: post.commentCount,
    isSystem: post.isSystem,
  }));

  const hasScore = fixture.home_score !== null && fixture.away_score !== null;
  const fanRatingSummaryRow = fanRatingSummary.data?.[0] ?? null;
  const fanRatingCount = fanRatingSummaryRow ? Number(fanRatingSummaryRow.rating_count) : 0;
  const fanRatingAvg =
    fanRatingSummaryRow?.avg_rating !== null && fanRatingSummaryRow?.avg_rating !== undefined
      ? Number(fanRatingSummaryRow.avg_rating)
      : null;
  // RECOMMENDATIONS.md item 171: aggregates item 170's real fan rating data
  // with real match-room reaction counts already fetched above for the Room
  // tab (roomPosts) — no new query, just a sum of numbers that were already
  // real.
  const roomReactionCount = roomPosts.reduce((sum, post) => sum + post.reactionCount, 0);

  // Each team's current manager. A team can in principle have more than one
  // `managers` row pointing at it (a managerial change leaves the old coach's
  // current_team_id stale rather than clearing it — see upsertManager in
  // sync-squads.ts), so this takes the most-recently-synced row per team
  // (query above is already ordered updated_at desc) rather than assuming
  // exactly one.
  const homeManager = (managers ?? []).find((m) => m.current_team_id === fixture.home_team?.id) ?? null;
  const awayManager = (managers ?? []).find((m) => m.current_team_id === fixture.away_team?.id) ?? null;

  // MatchShareCard: reuses the exact fixture + fixture_events rows already
  // fetched above (buildMatchShareCardData internally filters to just the
  // goal-type events it needs) rather than issuing a second round trip via
  // getMatchShareCardData — this page already has everything that function
  // would otherwise re-fetch.
  const shareCardData =
    fixture.home_team && fixture.away_team
      ? buildMatchShareCardData(fixture, (events ?? []).map((e) => ({
          event_type: e.event_type,
          minute: e.minute,
          added_time: e.added_time,
          team_id: e.team_id,
          player_name: e.player?.known_as ?? e.player?.full_name ?? null,
        })))
      : null;
  const matchUrl = absoluteUrl(`/matches/${fixture.id}`);

  return (
    // Whole-page FadeIn (RECOMMENDATIONS.md item 271) so this route's
    // resolved content cross-dissolves in over MatchDetailLoading's skeleton
    // instead of hard-cutting — the header card below keeps its own nested
    // FadeIn too (a slightly different entrance, harmless to layer).
    <FadeIn className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn className="kivo-glass-brand sticky top-2 z-10 flex flex-col gap-4 rounded-2xl p-5">
        {/* Match-centre-only keyframes: a breathing live badge, an expanding
            "on air" ring on its dot, and a brief scale-in for the score on
            load. Scoped here (not globals.css) since this page is the only
            place they're used; the sitewide prefers-reduced-motion block in
            globals.css (`* { animation-duration: 0.01ms !important }`)
            already clamps these too, same as kivo-aurora. */}
        <style>{`
          @keyframes kivo-live-breathe {
            0%, 100% { opacity: 0.88; transform: scale(1); }
            50% { opacity: 1; transform: scale(1.04); }
          }
          @keyframes kivo-live-ring {
            0% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--kivo-live) 45%, transparent); }
            70% { box-shadow: 0 0 0 7px color-mix(in oklab, var(--kivo-live) 0%, transparent); }
            100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--kivo-live) 0%, transparent); }
          }
          @keyframes kivo-score-reveal {
            0% { opacity: 0; transform: scale(0.82); }
            100% { opacity: 1; transform: scale(1); }
          }
          /* RECOMMENDATIONS.md item 18/316: kivo-score-reveal above fires
             identically for a genuine goal and a routine sync correction.
             MatchScoreDisplay only plays this one on a real, detected score
             increase — reusing kivo-gradient-victory (already the app's
             real achievement color) as a brief glow layered behind the
             score, so an actual goal gets a visibly bigger moment than a
             stat nudge, on top of the existing reveal rather than
             replacing it. */
          @keyframes kivo-goal-glow {
            0% { opacity: 0; transform: scale(0.85); }
            30% { opacity: 0.55; transform: scale(1.08); }
            100% { opacity: 0; transform: scale(1); }
          }
        `}</style>

        <div className="flex items-center justify-between text-xs text-foreground-subtle">
          <span>{fixture.competition?.short_name ?? fixture.competition?.name ?? "Unknown competition"}</span>
          {fixture.venue?.name && (
            <Link href={`/venues/${fixture.venue.id}`} className="flex items-center gap-1 transition hover:text-accent">
              <MapPin className="h-3 w-3" strokeWidth={2} />
              {fixture.venue.name}
              {fixture.venue.city ? `, ${fixture.venue.city}` : ""}
            </Link>
          )}
        </div>

        <LastSyncedNote timestamp={fixturesLastSyncedAt} label="Score and status synced" />

        <div className="flex items-center justify-between gap-3">
          <FadeIn delay={0.08} className="flex flex-1 flex-col items-center gap-2">
            <TeamCrest crestUrl={fixture.home_team?.crest_url ?? null} name={fixture.home_team?.name ?? "Home"} size={40} />
            <span className="text-center text-sm font-medium text-foreground">{fixture.home_team?.name ?? "Home team"}</span>
            {homeManager && (
              <Link
                href={`/managers/${homeManager.id}`}
                className="max-w-full truncate text-center text-[11px] text-foreground-subtle transition hover:text-accent"
              >
                {homeManager.full_name}
              </Link>
            )}
          </FadeIn>

          <MatchScoreDisplay
            fixtureId={fixture.id}
            status={fixture.status}
            homeScore={fixture.home_score}
            awayScore={fixture.away_score}
            minuteElapsed={fixture.minute_elapsed}
            kickoffAt={fixture.kickoff_at}
          />

          <FadeIn delay={0.08} className="flex flex-1 flex-col items-center gap-2">
            <TeamCrest crestUrl={fixture.away_team?.crest_url ?? null} name={fixture.away_team?.name ?? "Away"} size={40} />
            <span className="text-center text-sm font-medium text-foreground">{fixture.away_team?.name ?? "Away team"}</span>
            {awayManager && (
              <Link
                href={`/managers/${awayManager.id}`}
                className="max-w-full truncate text-center text-[11px] text-foreground-subtle transition hover:text-accent"
              >
                {awayManager.full_name}
              </Link>
            )}
          </FadeIn>
        </div>

        {/* RECOMMENDATIONS.md items 184/185: real, fixture-scoped AI
            grounding entry point — deep-links into /ai with this exact
            fixture pre-loaded as context, see ask-ai-link.tsx. */}
        <AskAiLink ctx="fixture" id={fixture.id} label="Ask AI about this match" />
      </FadeIn>

      {/* RECOMMENDATIONS.md item 293: the caller's own real prediction for
          this exact fixture — renders nothing when they haven't made one
          (ownPrediction is null in that case, predictions_select_own already
          scoped this to their own row). */}
      {ownPrediction && (
        <FadeIn delay={0.09}>
          <YourPredictionCard
            predictedOutcome={ownPrediction.predicted_outcome}
            pointsAwarded={ownPrediction.points_awarded}
            status={fixture.status}
          />
        </FadeIn>
      )}

      {/* RECOMMENDATIONS.md item 170: only shown once the match is actually
          over — "rate a performance after the whistle" is the item's own
          framing, and fan_ratings_insert_own's WITH CHECK would reject an
          earlier submission anyway. */}
      {isFinished && (
        <FadeIn delay={0.1}>
          <FanRatingCard
            fixtureId={fixture.id}
            signedIn={Boolean(profile)}
            initialRating={ownFanRating.data?.rating ?? null}
            ratingCount={fanRatingCount}
            avgRating={fanRatingAvg}
          />
        </FadeIn>
      )}

      {/* RECOMMENDATIONS.md item 171: renders nothing itself once there's
          neither a real rating average nor any real Room activity — see the
          component's own early return. */}
      {isFinished && fixture.home_team && fixture.away_team && (
        <FadeIn delay={0.12}>
          <MatchVerdictCard
            homeTeamName={fixture.home_team.name}
            awayTeamName={fixture.away_team.name}
            scoreLabel={hasScore ? `${fixture.home_score} – ${fixture.away_score}` : "vs"}
            fanRatingCount={fanRatingCount}
            fanRatingAvg={fanRatingAvg}
            roomReactionCount={roomReactionCount}
            roomPostCount={roomPosts.length}
          />
        </FadeIn>
      )}

      {/* RECOMMENDATIONS.md item 161: only shown when these two teams have
          at least one prior finished meeting on record — a debut fixture
          between them shouldn't render a zero-state card here. */}
      {headToHead && headToHead.meetings.length > 0 && fixture.home_team && fixture.away_team && (
        <FadeIn delay={0.11}>
          <HeadToHeadCard
            teamA={{ name: fixture.home_team.name, shortName: fixture.home_team.short_name }}
            teamB={{ name: fixture.away_team.name, shortName: fixture.away_team.short_name }}
            record={headToHead}
          />
        </FadeIn>
      )}

      {/* RECOMMENDATIONS.md's MatchShareCard feature: a real, dynamic share
          card for this exact fixture -- never rendered for a fixture with no
          resolved teams (shareCardData is null in that case). */}
      {shareCardData && (
        <FadeIn delay={0.13} className="kivo-glass flex flex-col gap-3 rounded-3xl p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
            <Share2 className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
            Share this match
          </h2>
          <MatchShareCard fixtureId={fixture.id} data={shareCardData} matchUrl={matchUrl} />
        </FadeIn>
      )}

      <FadeIn delay={0.14}>
        <WidgetErrorBoundary context="matchCentreTabs" label="Match detail">
          <MatchCentreTabs
            fixtureId={fixture.id}
            homeTeamId={fixture.home_team?.id ?? ""}
            awayTeamId={fixture.away_team?.id ?? ""}
            homeTeamName={fixture.home_team?.name ?? "Home team"}
            awayTeamName={fixture.away_team?.name ?? "Away team"}
            roomPosts={roomPostsForTab}
            scrollToPostId={targetPostId ?? null}
            stats={statsForTab}
            signedIn={Boolean(profile)}
            canSyncDetails={canManageFootballData(profile?.role)}
            syncDetailsAction={triggerFixtureDetailsSync.bind(null, fixture.id)}
            detailsLastSyncedAt={detailsLastSyncedAt}
            viewerFantasyRoster={viewerFantasyRosterForTab}
            events={(events ?? []).map((e) => ({
              id: e.id,
              eventType: e.event_type,
              minute: e.minute,
              addedTime: e.added_time,
              detail: e.detail,
              teamId: e.team_id,
              playerId: e.player?.id ?? null,
              playerName: e.player?.known_as ?? e.player?.full_name ?? null,
              relatedPlayerId: e.related_player?.id ?? null,
              relatedPlayerName: e.related_player?.known_as ?? e.related_player?.full_name ?? null,
            }))}
            lineups={(lineups ?? []).map((l) => ({
              teamId: l.team_id,
              isStarting: l.is_starting,
              shirtNumber: l.shirt_number,
              position: l.position,
              formation: l.formation,
              playerId: l.player?.id ?? "",
              playerName: l.player?.known_as ?? l.player?.full_name ?? "Unknown player",
            }))}
            standings={(standings ?? []).map((s) => ({
              teamId: s.team_id,
              teamName: s.team?.name ?? "Unknown team",
              crestUrl: s.team?.crest_url ?? null,
              played: s.played,
              won: s.won,
              drawn: s.drawn,
              lost: s.lost,
              goalsFor: s.goals_for,
              goalsAgainst: s.goals_against,
              points: s.points,
              position: s.position,
            }))}
          />
        </WidgetErrorBoundary>
      </FadeIn>

      <Link
        href="/matches"
        className="self-center text-xs text-foreground-subtle underline decoration-hairline-strong underline-offset-4 hover:text-foreground-muted"
      >
        Back to today&apos;s matches
      </Link>
    </FadeIn>
  );
}
