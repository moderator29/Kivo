import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { triggerFixtureDetailsSync } from "@/app/admin/data-health/actions";
import { FadeIn } from "@/components/ui/fade-in";
import { LastSyncedNote } from "@/components/football/last-synced-note";
import { MatchCentreTabs } from "@/components/matches/match-centre-tabs";
import { TeamCrest } from "@/components/ui/team-crest";
import { HeadToHeadCard } from "@/components/football/head-to-head-card";
import { FanRatingCard } from "@/components/matches/fan-rating-card";
import { STATUS_LABEL, isLiveStatus } from "@/lib/football/fixture-status";
import { getLastSyncedAt } from "@/lib/football/last-synced";
import { getHeadToHead } from "@/lib/football/head-to-head";
import { fetchPostsPage } from "@/app/(app)/social/posts";

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

export default async function MatchCentrePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerSupabaseClient();
  const profile = await getOrCreateProfile();

  const { data: fixture } = await supabase
    .from("fixtures")
    .select(
      `id, kickoff_at, status, home_score, away_score, season_id,
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
    { posts: roomPosts },
    fixturesLastSyncedAt,
    detailsLastSyncedAt,
    headToHead,
    ownFanRating,
    fanRatingSummary,
  ] = await Promise.all([
    supabase
      .from("fixture_events")
      .select(
        `id, event_type, minute, added_time, detail, team_id,
         player:players!fixture_events_player_id_fkey(full_name, known_as),
         related_player:players!fixture_events_related_player_id_fkey(full_name, known_as)`,
      )
      .eq("fixture_id", id)
      .order("minute", { ascending: true }),
    supabase
      .from("lineups")
      .select("team_id, is_starting, shirt_number, position, player:players(id, full_name, known_as)")
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
  ]);

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
    reactionCount: post.reactionCount,
    viewerReaction: post.viewerReaction,
    commentCount: post.commentCount,
  }));

  const hasScore = fixture.home_score !== null && fixture.away_score !== null;
  const live = isLiveStatus(fixture.status);
  const fanRatingSummaryRow = fanRatingSummary.data?.[0] ?? null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
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
            0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.45); }
            70% { box-shadow: 0 0 0 7px rgba(34, 197, 94, 0); }
            100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
          }
          @keyframes kivo-score-reveal {
            0% { opacity: 0; transform: scale(0.82); }
            100% { opacity: 1; transform: scale(1); }
          }
        `}</style>

        <div className="flex items-center justify-between text-xs text-foreground-subtle">
          <span>{fixture.competition?.short_name ?? fixture.competition?.name ?? "Unknown competition"}</span>
          {fixture.venue?.name && (
            <Link href={`/venues/${fixture.venue.id}`} className="flex items-center gap-1 transition hover:text-kivo-cyan">
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
          </FadeIn>

          <div className="flex shrink-0 flex-col items-center gap-1">
            <span className="animate-[kivo-score-reveal_0.5s_ease-out_0.1s_both] text-2xl font-semibold text-foreground">
              {hasScore ? `${fixture.home_score} – ${fixture.away_score}` : "vs"}
            </span>
            <span
              className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                live
                  ? "animate-[kivo-live-breathe_2.2s_ease-in-out_infinite] border-live/30 bg-live/10 text-live"
                  : "border-white/10 text-foreground-subtle"
              }`}
            >
              {live && (
                <span className="h-1.5 w-1.5 shrink-0 animate-[kivo-live-ring_2s_ease-out_infinite] rounded-full bg-live" />
              )}
              {fixture.status === "scheduled"
                ? new Date(fixture.kickoff_at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : STATUS_LABEL[fixture.status]}
            </span>
          </div>

          <FadeIn delay={0.08} className="flex flex-1 flex-col items-center gap-2">
            <TeamCrest crestUrl={fixture.away_team?.crest_url ?? null} name={fixture.away_team?.name ?? "Away"} size={40} />
            <span className="text-center text-sm font-medium text-foreground">{fixture.away_team?.name ?? "Away team"}</span>
          </FadeIn>
        </div>
      </FadeIn>

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
            ratingCount={fanRatingSummaryRow ? Number(fanRatingSummaryRow.rating_count) : 0}
            avgRating={fanRatingSummaryRow?.avg_rating !== null && fanRatingSummaryRow?.avg_rating !== undefined ? Number(fanRatingSummaryRow.avg_rating) : null}
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

      <FadeIn delay={0.14}>
        <MatchCentreTabs
          fixtureId={fixture.id}
          homeTeamId={fixture.home_team?.id ?? ""}
          awayTeamId={fixture.away_team?.id ?? ""}
          roomPosts={roomPostsForTab}
          stats={statsForTab}
          signedIn={Boolean(profile)}
          canSyncDetails={canManageFootballData(profile?.role)}
          syncDetailsAction={triggerFixtureDetailsSync.bind(null, fixture.id)}
          detailsLastSyncedAt={detailsLastSyncedAt}
          events={(events ?? []).map((e) => ({
            id: e.id,
            eventType: e.event_type,
            minute: e.minute,
            addedTime: e.added_time,
            detail: e.detail,
            teamId: e.team_id,
            playerName: e.player?.known_as ?? e.player?.full_name ?? null,
            relatedPlayerName: e.related_player?.known_as ?? e.related_player?.full_name ?? null,
          }))}
          lineups={(lineups ?? []).map((l) => ({
            teamId: l.team_id,
            isStarting: l.is_starting,
            shirtNumber: l.shirt_number,
            position: l.position,
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
      </FadeIn>

      <Link
        href="/matches"
        className="self-center text-xs text-foreground-subtle underline decoration-white/20 underline-offset-4 hover:text-foreground-muted"
      >
        Back to today&apos;s matches
      </Link>
    </div>
  );
}
