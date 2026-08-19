import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Share2 } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readOptionalRow, readRow } from "@/lib/query-result";
import { getOrCreateProfile } from "@/lib/profile";
import { getActiveProviderStatus } from "@/lib/football";
import { FadeIn } from "@/components/ui/fade-in";
import { resolveBackgroundSrc } from "@/lib/kivo-assets";
import { WidgetErrorBoundary } from "@/components/ui/soft-error-boundary";
import { MatchCentreTabs } from "@/components/matches/match-centre-tabs";
import { MatchHero } from "@/components/matches/match-hero";
import { FanRatingCard } from "@/components/matches/fan-rating-card";
import { MatchVerdictCard } from "@/components/matches/match-verdict-card";
import { MatchShareCard } from "@/components/matches/match-share-card";
import { ShareCardPanel } from "@/components/share/share-card-panel";
import { YourPredictionCard } from "@/components/matches/your-prediction-card";
import { PREDICTION_PICK_COLUMNS, pickFromRow } from "@/lib/predictions";
import { getLastSyncedAt } from "@/lib/football/last-synced";
import { competitionName } from "@/lib/football/competition-label";
import { getHeadToHead } from "@/lib/football/head-to-head";
import { computeTeamForm, resolveFixtureResult, type FixtureResultRow, type ResolvedResult } from "@/lib/football/form-engine";
import { buildMatchShareCardData } from "@/lib/football/match-share-card";
import { getViewerFantasyRosterBySeasons, type ViewerFantasyRosterMap } from "@/lib/football/fantasy-lineup-crossref";
import { fetchPostsPage } from "@/app/(app)/social/posts";
import { absoluteUrl } from "@/lib/site-url";
import { viewerIsSignedIn } from "@/lib/guest-preview";
import { getRoomVerdictExtras } from "@/lib/football/room-verdict";
import { matchRoomWindow } from "@/lib/match-room-window";
import { roundText } from "@/lib/football/round-label";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = createServerSupabaseClient();
  // readOptionalRow, not readRow: a title is not worth a 500. A failed read
  // here is logged and falls back to the generic title, and the page itself
  // still gets its own chance to load the fixture properly below.
  const fixture = readOptionalRow(
    await supabase
      .from("fixtures")
      .select(
        `home_team:teams!fixtures_home_team_id_fkey(name),
         away_team:teams!fixtures_away_team_id_fkey(name)`,
      )
      .eq("id", id)
      .maybeSingle(),
    "matches.detail.metadata",
  );

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

  // `{ data: fixture }` with the error discarded used to gate `notFound()`
  // directly, which meant a dropped connection or an expired token on the
  // most-opened detail page in the product rendered "that doesn't exist"
  // about a fixture that exists perfectly well. A 404 is a claim about the
  // world; a failed read is a fact about the request, and the two must not
  // share a branch. readRow throws on error so the error boundary handles it
  // as what it is, and returns null only for a fixture that genuinely is not
  // there.
  const fixture = readRow(
    await supabase
      .from("fixtures")
      .select(
        `id, kickoff_at, status, home_score, away_score, minute_elapsed, season_id, matchday, referee, round_label,
         home_team:teams!fixtures_home_team_id_fkey(id, name, short_name, crest_url),
         away_team:teams!fixtures_away_team_id_fkey(id, name, short_name, crest_url),
         competition:competitions(id, name, short_name),
         venue:venues(id, name, city)`,
      )
      .eq("id", id)
      .maybeSingle(),
    "matches.detail",
  );

  if (!fixture) notFound();

  // RECOMMENDATIONS.md item 170: only meaningful once the match is actually
  // over — fan_ratings_insert_own's own WITH CHECK (0032) enforces this same
  // rule server-side, this just avoids fetching rating data for a fixture
  // nobody could have rated yet.
  const isFinished = fixture.status === "finished";

  // KIVO_NEXT_GEN KN-101. Only for a finished match, and only then — a
  // "busiest minute" of a match still being played is a moving number, and a
  // verdict is a thing you deliver afterwards. Returns nulls rather than
  // throwing if anything goes wrong; the verdict card simply omits the row.
  const roomVerdictExtras = isFinished
    ? await getRoomVerdictExtras(supabase, id, fixture.kickoff_at)
    : { busiestMinute: null, topReaction: null };

  // Read once, above the parallel block, because two things below need it and
  // it is a pure environment read rather than a query.
  const activeProvider = getActiveProviderStatus();

  const [
    { data: events },
    { data: lineups },
    { data: stats },
    { data: standings },
    { posts: roomPostsPage },
    fixturesLastSyncedAt,
    detailsLastSyncedAt,
    headToHead,
    { data: recentFinished },
    ownFanRating,
    fanRatingSummary,
    { data: managers },
    { data: ownPredictions },
    viewerFantasyRosterBySeason,
    // KN-53's own stated limitation, now closeable. That comment says the
    // Overview tab "cannot distinguish 'the provider does not support this for
    // this competition' from 'nobody has synced it yet', so it claims only the
    // second, which is the one thing that is always true." The coverage
    // registry (migration 0082) is the provider's own answer to the first, and
    // it is one filtered row on a public-select table — cheap enough for the
    // most-opened page in the product, and read with the ordinary client
    // because `provider_coverage_select_public` allows it.
    { data: coverageRow },
    { data: playerStatRows },
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
      .select("team_id, is_starting, shirt_number, position, formation, grid, player:players(id, full_name, known_as)")
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
      // zone_description / group_label (migration 0117) are the competition's
      // OWN words for where a line in the table sits and which table it is —
      // "Promotion - Champions League", "Group A". They arrive verbatim, so
      // the table can draw its zones without KIVO asserting a rule about any
      // league's qualification places, which is a claim with an expiry date.
      .select(
        `team_id, played, won, drawn, lost, goals_for, goals_against, points, position,
         zone_description, group_label, team:teams(name, crest_url)`,
      )
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
    // Real recent form for both clubs, for the Overview tab's Form section.
    // One query for the pair (a single `.or()` over four columns) rather than
    // two, and it reads only finished fixtures KIVO already holds — no
    // provider call, nothing computed that isn't a result already in the
    // database. Twenty rows covers both clubs' last five comfortably even
    // when one of them has played every one of the recent fixtures.
    fixture.home_team?.id && fixture.away_team?.id
      ? supabase
          .from("fixtures")
          .select("id, kickoff_at, status, home_score, away_score, home_team_id, away_team_id")
          .eq("status", "finished")
          .neq("id", fixture.id)
          .or(
            `home_team_id.in.(${fixture.home_team.id},${fixture.away_team.id}),away_team_id.in.(${fixture.home_team.id},${fixture.away_team.id})`,
          )
          .order("kickoff_at", { ascending: false })
          .limit(40)
      : Promise.resolve({ data: null }),
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
    // to the caller's own rows — no RLS change, no RPC needed.
    //
    // No longer maybeSingle(): a fixture now carries up to six predictions
    // from one person (one per type, per predictions_unique_per_fixture_type),
    // so this reads all of them and YourPredictionCard lists what it finds.
    profile
      ? supabase
          .from("predictions")
          .select(
            `id, points_awarded, ${PREDICTION_PICK_COLUMNS},
             player:players!predictions_predicted_player_id_fkey(id, full_name, known_as)`,
          )
          .eq("fixture_id", id)
          .eq("profile_id", profile.id)
      : Promise.resolve({ data: null }),
    // RECOMMENDATIONS.md item 294: real fantasy_rosters -> lineups player-id
    // cross-reference for LineupsTab's "In your XI" pill — see
    // getViewerFantasyRosterBySeasons' own doc comment for the full join
    // chain. Scoped to just this one fixture's season.
    profile
      ? getViewerFantasyRosterBySeasons(supabase, profile.id, [fixture.season_id])
      : Promise.resolve(new Map<string, ViewerFantasyRosterMap>()),
    fixture.competition?.id && activeProvider.name
      ? supabase
          .from("provider_coverage")
          .select("fixture_events, fixture_lineups, fixture_statistics, standings, retrieved_at")
          .eq("provider", activeProvider.name)
          .eq("competition_id", fixture.competition.id)
          .order("season_year", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // Every player's own line in this match (`fixture_player_statistics`,
    // migration 0081). One read of a table KIVO already fills and, until now,
    // nothing a fan could open ever showed — no provider call, no new cost.
    // Empty for a fixture nobody has fetched them for, and the Players section
    // is simply not offered in that case.
    supabase
      .from("fixture_player_statistics")
      .select(
        `team_id, minutes_played, position, is_substitute, goals, assists, shots_total, shots_on_target,
         passes_total, passes_key, pass_accuracy, tackles_total, blocks, interceptions, duels_total, duels_won,
         dribbles_attempted, dribbles_succeeded, fouls_drawn, fouls_committed, saves, goals_conceded, offsides,
         player:players(id, full_name, known_as)`,
      )
      .eq("fixture_id", id),
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

  // One player's own numbers for this match, per side. Nulls are carried
  // through untouched — `null` is "not recorded", never nought, and the whole
  // Players section is built on keeping those two apart.
  const playerLines = (playerStatRows ?? []).map((row) => ({
    playerId: row.player?.id ?? "",
    playerName: row.player?.known_as ?? row.player?.full_name ?? "Unknown player",
    teamId: row.team_id,
    position: row.position,
    isSubstitute: row.is_substitute,
    minutesPlayed: row.minutes_played,
    goals: row.goals,
    assists: row.assists,
    shotsTotal: row.shots_total,
    shotsOnTarget: row.shots_on_target,
    passesTotal: row.passes_total,
    passesKey: row.passes_key,
    passAccuracy: row.pass_accuracy,
    tacklesTotal: row.tackles_total,
    interceptions: row.interceptions,
    blocks: row.blocks,
    duelsTotal: row.duels_total,
    duelsWon: row.duels_won,
    dribblesAttempted: row.dribbles_attempted,
    dribblesSucceeded: row.dribbles_succeeded,
    foulsDrawn: row.fouls_drawn,
    foulsCommitted: row.fouls_committed,
    saves: row.saves,
    goalsConceded: row.goals_conceded,
    offsides: row.offsides,
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
    // KN-29: fetchPostsPage has always loaded this; the Room mapping used to
    // drop it on the floor, which is half of why a match-scoped poll had
    // nowhere to render.
    poll: post.poll,
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

  // Each club's own last-five form, from the finished fixtures fetched above.
  // `computeTeamForm` is the same engine /teams/[id] and /teams/compare use,
  // so the strip on this page and the strip on the club's own page cannot
  // disagree about the same five results. Null for a club with nothing
  // finished on record — the Overview says that in words rather than drawing
  // an empty badge strip.
  function formFor(teamId: string | undefined) {
    if (!teamId) return null;
    const resolved: ResolvedResult[] = ((recentFinished ?? []) as FixtureResultRow[])
      .filter((f) => f.home_team_id === teamId || f.away_team_id === teamId)
      .map((f) => resolveFixtureResult(f, teamId))
      .filter((r): r is ResolvedResult => r !== null);
    return resolved.length > 0 ? computeTeamForm(resolved, "last5") : null;
  }
  const homeForm = formFor(fixture.home_team?.id);
  const awayForm = formFor(fixture.away_team?.id);

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
  // The text a native share sheet sends alongside the picture. Built from the
  // same real fixture row the card is, so the two can never disagree.
  const shareText =
    fixture.home_score != null && fixture.away_score != null
      ? `${fixture.home_team?.name ?? "Home"} ${fixture.home_score} - ${fixture.away_score} ${fixture.away_team?.name ?? "Away"} — on KIVO.`
      : `${fixture.home_team?.name ?? "Home"} vs ${fixture.away_team?.name ?? "Away"} — on KIVO.`;

  // Null for a signed-out visitor and for anyone who has never chosen one —
  // the banner then keeps exactly the gradient it always had.
  const matchBannerSrc = profile ? resolveBackgroundSrc(profile) : null;

  /**
   * The things a fan does *about* a match rather than reads *in* it: the call
   * they made on it, the mark they gave it, the room's verdict, and the cards
   * they might send someone. Every one of them renders only on real data —
   * they are unchanged from the versions that used to sit above the tab rail,
   * and each still returns nothing at all when its own data is absent.
   *
   * They are handed to the Match Centre as the tail of the Overview section.
   * That is a hierarchy decision, not a tidy-up: they were four cards deep and
   * they stood between the scoreline and the control that reaches the
   * line-ups, so on a phone the section rail was below the fold on a page
   * whose entire job is those sections.
   */
  const overviewExtras = (
    <div className="flex flex-col gap-3 pt-3">
      {/* RECOMMENDATIONS.md item 293: the caller's own real prediction for
          this exact fixture — renders nothing when they haven't made one
          (the list is empty in that case, predictions_select_own already
          scoped this to their own row). */}
      {ownPredictions && ownPredictions.length > 0 && (
        <FadeIn delay={0.09}>
          <YourPredictionCard
            predictions={ownPredictions.map((row) => ({
              id: row.id,
              pick: pickFromRow(row),
              playerName: row.player?.known_as ?? row.player?.full_name ?? null,
              pointsAwarded: row.points_awarded,
              resolution: row.resolution,
              unresolvableReason: row.unresolvable_reason,
            }))}
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
            signedIn={viewerIsSignedIn(profile)}
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
            busiestMinute={roomVerdictExtras.busiestMinute}
            topReaction={roomVerdictExtras.topReaction}
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

          {/* The template card above composites this fixture onto one fixed
              piece of KIVO artwork. These two sit on whichever background the
              user picks, which is the founder's own instruction for the card
              set — see src/lib/share-cards/. The prediction panel renders
              nothing at all unless this viewer actually called this match. */}
          <ShareCardPanel
            kind="live-score"
            id={fixture.id}
            shareUrl={`/matches/${fixture.id}`}
            shareText={shareText}
            heading="Score card"
            description="Pick a background. The preview is the exact image you save."
          />
          <ShareCardPanel
            kind="prediction"
            id={fixture.id}
            shareUrl={`/matches/${fixture.id}`}
            shareText={shareText}
            heading="Your call on this match"
          />
        </FadeIn>
      )}
    </div>
  );

  // One freshness line for the page, and it is a fact for a fan rather than a
  // readout for an operator: how current what they are looking at is.
  //
  // There are two real timestamps behind it — when the score and status were
  // last brought in, and when this fixture's line-ups, events and statistics
  // were — and the page used to print BOTH, three hundred pixels apart, in
  // identical words. Two "Updated 4d ago" lines on one screen read as a bug.
  // The later of the two is the answer to the question the line actually asks.
  const pageLastUpdatedAt = [fixturesLastSyncedAt, detailsLastSyncedAt]
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1) ?? null;

  const round = roundText({ roundLabel: fixture.round_label, matchday: fixture.matchday });

  return (
    // Whole-page FadeIn (RECOMMENDATIONS.md item 271) so this route's resolved
    // content cross-dissolves in over MatchDetailLoading's skeleton instead of
    // hard-cutting.
    //
    // THE SHAPE OF THIS PAGE, and why it changed. It used to be: banner, then
    // the viewer's prediction, then a rating card, then a verdict card, then a
    // share block with three surfaces in it, and only then the tab rail that
    // reaches the line-ups, the timeline and the table. On a phone the rail —
    // the most-tapped control in the product — started around the fourth
    // screenful, which is what the founder was looking at when he compared
    // this page to the ones fans actually use.
    //
    // It is now the shape every match page a fan already trusts has: the
    // score, the sections, the section. Nothing was deleted; the cards that
    // sat in the gap moved into the front page they belong to, which is the
    // Overview section, as `overviewExtras` below.
    <FadeIn className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-6 lg:px-8">
      <MatchHero
        fixtureId={fixture.id}
        home={{
          id: fixture.home_team?.id ?? null,
          name: fixture.home_team?.name ?? "Home team",
          crestUrl: fixture.home_team?.crest_url ?? null,
        }}
        away={{
          id: fixture.away_team?.id ?? null,
          name: fixture.away_team?.name ?? "Away team",
          crestUrl: fixture.away_team?.crest_url ?? null,
        }}
        status={fixture.status}
        homeScore={fixture.home_score}
        awayScore={fixture.away_score}
        minuteElapsed={fixture.minute_elapsed}
        kickoffAt={fixture.kickoff_at}
        competitionLabel={competitionName(fixture.competition, "short")}
        roundLabel={round}
        venue={
          fixture.venue?.name ? { id: fixture.venue.id, name: fixture.venue.name, city: fixture.venue.city } : null
        }
        bannerSrc={matchBannerSrc}
        lastUpdatedAt={pageLastUpdatedAt}
      />

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
            signedIn={viewerIsSignedIn(profile)}
            viewer={profile ? { id: profile.id, name: profile.display_name || profile.username } : null}
            // The real score, for the rating engine's clean-sheet and
            // goals-conceded terms. Null before either is reported, which is
            // exactly when the engine refuses to rate anybody.
            homeScore={fixture.home_score}
            awayScore={fixture.away_score}
            homeForm={homeForm}
            awayForm={awayForm}
            // Already joined above for this page's own header — the Lineups
            // tab is where a fan looks for the name that picked the eleven.
            homeManager={homeManager ? { id: homeManager.id, name: homeManager.full_name } : null}
            awayManager={awayManager ? { id: awayManager.id, name: awayManager.full_name } : null}
            // KN-53: all already fetched above for this page's own header —
            // passed down so the collapsed-tab Overview can be worth opening
            // rather than four copies of "nothing synced yet".
            // The Room opens when the fixture is created and closes 24 hours
            // after full time (src/lib/match-room-window.ts). Decided here, on
            // the server, so the client's first render cannot disagree with the
            // HTML — the client then keeps it current off its own clock.
            roomWindow={matchRoomWindow(fixture.kickoff_at, fixture.status)}
            preMatch={{
              kickoffAt: fixture.kickoff_at,
              status: fixture.status,
              competitionName: fixture.competition?.short_name ?? fixture.competition?.name ?? null,
              venueName: fixture.venue?.name ?? null,
              venueCity: fixture.venue?.city ?? null,
              // Migration 0113. Both were already on the provider payload KIVO
              // pays for and were dropped by the adapter; the Overview tab is
              // where a fan looks for them.
              referee: fixture.referee,
              // The label, not the number. `matchday` is null for a cup tie,
              // and this is the only thing that names its round.
              roundLabel: fixture.round_label,
              matchday: fixture.matchday,
            }}
            // RECOMMENDATIONS.md item 161, now as a Match Centre tab rather
            // than a card stranded below the whole tab strip. Null unless both
            // clubs resolved, and the tab itself is only offered when there is
            // a real prior meeting on record — a debut fixture between them
            // shows no H2H tab at all rather than an empty one.
            // The provider's own statement, passed through untouched: a false
            // is a denial it made, a null is KIVO not knowing. The Overview
            // panel is the only reader, and it says nothing on a null.
            competitionCoverage={
              coverageRow
                ? {
                    events: coverageRow.fixture_events,
                    lineups: coverageRow.fixture_lineups,
                    statistics: coverageRow.fixture_statistics,
                    // The one thing that can honestly remove the table from a
                    // cup tie's Match Centre. A `false` here is the data
                    // source's own statement that this competition has no
                    // table at all; a null is KIVO not knowing, and the
                    // section stays offered.
                    standings: coverageRow.standings,
                  }
                : null
            }
            homePlayerLines={playerLines.filter((line) => line.teamId === fixture.home_team?.id)}
            awayPlayerLines={playerLines.filter((line) => line.teamId === fixture.away_team?.id)}
            overviewExtras={overviewExtras}
            headToHead={
              headToHead && fixture.home_team && fixture.away_team
                ? {
                    teamA: { name: fixture.home_team.name, shortName: fixture.home_team.short_name },
                    teamB: { name: fixture.away_team.name, shortName: fixture.away_team.short_name },
                    record: headToHead,
                  }
                : null
            }
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
              grid: l.grid,
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
              zoneDescription: s.zone_description,
              groupLabel: s.group_label,
            }))}
          />
        </WidgetErrorBoundary>
      </FadeIn>
    </FadeIn>
  );
}
