import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalDateTime } from "@/components/ui/relative-time";
import { Shield } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { triggerStandingsSync } from "@/app/admin/data-health/actions";
import { FadeIn } from "@/components/ui/fade-in";
import { FollowButton } from "@/components/ui/follow-button";
import { TeamCrest } from "@/components/ui/team-crest";
import { CompetitionLogo } from "@/components/ui/competition-logo";
import { InlineSyncButton } from "@/components/admin/inline-sync-button";
import { LastSyncedNote } from "@/components/football/last-synced-note";
import { TrackView } from "@/components/ui/track-view";
import { getLastSyncedAt } from "@/lib/football/last-synced";
import { readRow } from "@/lib/query-result";
import { viewerIsSignedIn } from "@/lib/guest-preview";
import { CompetitionCoveragePanel } from "@/components/football/coverage-panel";
import { TopScorersPanel } from "@/components/football/top-scorers-panel";
import { ShareCardPanel } from "@/components/share/share-card-panel";
import { competitionMetaLine } from "@/lib/football/competition-label";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = createServerSupabaseClient();
  const { data: competition } = await supabase
    .from("competitions")
    .select("name, short_name")
    .eq("id", id)
    .maybeSingle();
  const name = (competition?.short_name ?? competition?.name) || null;
  if (!name) return { title: "League" };

  const description = `${name} standings, fixtures, and results on KIVO.`;
  return {
    title: name,
    description,
    openGraph: { title: name, description },
    twitter: { title: name, description },
  };
}

export default async function LeagueDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { id } = await params;
  const { season: requestedSeasonId } = await searchParams;
  const supabase = createServerSupabaseClient();
  const profile = await getOrCreateProfile();

  const [competitionResult, isFollowing, standingsLastSyncedAt] = await Promise.all([
    supabase
      .from("competitions")
      .select("id, name, short_name, country, logo_url, seasons(id, name, is_current)")
      .eq("id", id)
      .maybeSingle(),
    profile
      ? supabase
          .from("follows")
          .select("id", { count: "exact", head: true })
          .eq("follower_profile_id", profile.id)
          .eq("followed_type", "competition")
          .eq("followed_id", id)
          .then(({ count }) => (count ?? 0) > 0)
      : Promise.resolve(false),
    // RECOMMENDATIONS.md item 60: standings sync writes entity_type 'standing'
    // (see syncStandings in src/lib/football/sync-match-details.ts).
    getLastSyncedAt(["standing"]),
  ]);

  // A failed read is not a missing competition. readRow throws so the route's
  // error boundary handles it, and only a genuinely absent row reaches
  // notFound() — see src/lib/query-result.ts.
  const competition = readRow(competitionResult, "leagues.detail");
  if (!competition) notFound();

  // Newest first, so the switcher reads the way a fan thinks about seasons and
  // "the first one" is a sensible fallback rather than whatever the join
  // happened to return. `provider_year` is not selected here, so ordering is by
  // the season's own name, which the provider writes as the "2025/26" span.
  const seasons = [...(competition.seasons ?? [])].sort((left, right) => right.name.localeCompare(left.name));

  const currentSeason = seasons.find((s) => s.is_current) ?? seasons[0];

  // `?season=` may only ever name a season belonging to THIS competition.
  // Anything else — another competition's season, a deleted one, a hand-edited
  // id — falls back to the current season rather than rendering one
  // competition's table under another's name and logo. That is the same class
  // of error as pairing two numbers whose scopes differ: every figure would be
  // real, and the page around them would be wrong about what they describe.
  const activeSeason = seasons.find((s) => s.id === requestedSeasonId) ?? currentSeason;

  const { data: standings } = activeSeason
    ? await supabase
        .from("standings")
        .select("team_id, played, won, drawn, lost, goals_for, goals_against, points, position, team:teams(id, name, crest_url)")
        .eq("season_id", activeSeason.id)
        .order("position", { ascending: true })
    : { data: null };

  const { data: upcoming } = activeSeason
    ? await supabase
        .from("fixtures")
        .select(
          `id, kickoff_at, home_team:teams!fixtures_home_team_id_fkey(name, crest_url), away_team:teams!fixtures_away_team_id_fkey(name, crest_url)`,
        )
        .eq("season_id", activeSeason.id)
        .eq("status", "scheduled")
        .gt("kickoff_at", new Date().toISOString())
        .order("kickoff_at", { ascending: true })
        .limit(10)
    : { data: null };

  // Results: the other half of a season, and the page only ever showed
  // fixtures that hadn't happened. Finished only — a postponed or abandoned
  // match has no result to report, and listing one under "Results" with a
  // blank score would invite the reader to supply their own.
  const { data: results } = activeSeason
    ? await supabase
        .from("fixtures")
        .select(
          `id, kickoff_at, home_score, away_score, home_team:teams!fixtures_home_team_id_fkey(name, crest_url), away_team:teams!fixtures_away_team_id_fkey(name, crest_url)`,
        )
        .eq("season_id", activeSeason.id)
        .eq("status", "finished")
        .not("home_score", "is", null)
        .not("away_score", "is", null)
        .order("kickoff_at", { ascending: false })
        .limit(10)
    : { data: null };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <TrackView type="league" id={competition.id} name={competition.name} imageUrl={competition.logo_url} />
      <div className="flex items-center gap-3">
        <FadeIn delay={0} className="shrink-0">
          <CompetitionLogo logoUrl={competition.logo_url} name={competition.name} size={36} />
        </FadeIn>
        <FadeIn delay={0.05} className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-foreground">{competition.name}</h1>
          {/* A null country is missing metadata, not evidence that this is an
              international competition, so it prints nothing. With neither a
              country nor a season, the whole line is omitted. */}
          {competitionMetaLine([competition.country, activeSeason?.name]) && (
            <p className="text-xs text-foreground-subtle">
              {competitionMetaLine([competition.country, activeSeason?.name])}
            </p>
          )}
        </FadeIn>
        <FadeIn delay={0.1}>
          <FollowButton targetType="competition" targetId={competition.id} initialFollowing={isFollowing} signedIn={viewerIsSignedIn(profile)} />
        </FadeIn>
      </div>

      {/* Only when there is genuinely something to switch between. One synced
          season renders no control, because a picker with a single option is
          chrome pretending to be a choice. Plain links rather than a client
          control: the whole page is server-rendered per season, so each season
          gets a real URL that can be shared and opened in a new tab. */}
      {seasons.length > 1 && (
        <FadeIn delay={0.13} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Season</h2>
          <div
            className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
            role="group"
            aria-label="Season"
          >
            {seasons.map((season) => {
              const isActive = season.id === activeSeason?.id;
              return (
                <Link
                  key={season.id}
                  href={`/leagues/${competition.id}?season=${season.id}`}
                  aria-current={isActive ? "page" : undefined}
                  className={`kivo-focus shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                    isActive
                      ? "bg-accent text-on-accent"
                      : "kivo-glass-sharp text-foreground-muted hover:text-foreground"
                  }`}
                >
                  {season.name}
                  {season.is_current && !isActive ? " · now" : ""}
                </Link>
              );
            })}
          </div>
        </FadeIn>
      )}

      <FadeIn delay={0.15} className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Standings</h2>
          <LastSyncedNote timestamp={standingsLastSyncedAt} />
        </div>
        {!standings || standings.length === 0 ? (
          <div className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-6 text-center text-sm text-foreground-muted">
            Standings haven&apos;t been synced yet for this competition.
            {activeSeason && canManageFootballData(profile?.role) && (
              <InlineSyncButton
                label="Sync standings"
                action={triggerStandingsSync.bind(null, activeSeason.id)}
                hint="Needs this competition's fixtures synced first, so it has a provider mapping."
              />
            )}
          </div>
        ) : (
          // Real `<table>` with `scope="col"` headers (RECOMMENDATIONS.md item
          // 150): this used to be a grid of `<span>`s, which carries no
          // row/column relationships for assistive tech. The team name is now
          // the one link per row (its own tab stop with a clean accessible
          // name) rather than the whole row, since a screen reader announcing
          // every stat column as part of one giant link's name is worse, not
          // better.
          <div className="kivo-glass overflow-x-auto rounded-2xl">
            <table className="w-full min-w-[34rem] border-collapse text-xs">
              <thead>
                <tr className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                  <th scope="col" className="px-3 py-2 text-left font-semibold">#</th>
                  <th scope="col" className="py-2 text-left font-semibold">Team</th>
                  <th scope="col" className="py-2 text-right font-semibold">P</th>
                  <th scope="col" className="py-2 text-right font-semibold">W</th>
                  <th scope="col" className="py-2 text-right font-semibold">D</th>
                  <th scope="col" className="py-2 text-right font-semibold">L</th>
                  <th scope="col" className="py-2 text-right font-semibold">GD</th>
                  <th scope="col" className="px-3 py-2 text-right font-semibold">Pts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {standings.map((row) => (
                  <tr key={row.team_id} className="transition-colors hover:bg-surface-2">
                    <td className="px-3 py-2 text-foreground-subtle">{row.position ?? "-"}</td>
                    <td className="max-w-0 py-2 text-foreground">
                      {row.team?.id ? (
                        <Link
                          href={`/teams/${row.team.id}`}
                          className="flex items-center gap-2 truncate rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                        >
                          <TeamCrest crestUrl={row.team.crest_url} name={row.team.name} size={16} />
                          <span className="truncate">{row.team.name}</span>
                        </Link>
                      ) : (
                        <span className="flex items-center gap-2 truncate">
                          <Shield className="h-4 w-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
                          <span className="truncate">Unknown team</span>
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right text-foreground-muted">{row.played}</td>
                    <td className="py-2 text-right text-foreground-muted">{row.won}</td>
                    <td className="py-2 text-right text-foreground-muted">{row.drawn}</td>
                    <td className="py-2 text-right text-foreground-muted">{row.lost}</td>
                    <td className="py-2 text-right text-foreground-muted">{row.goals_for - row.goals_against}</td>
                    <td className="px-3 py-2 text-right font-semibold text-foreground">{row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </FadeIn>

      <FadeIn delay={0.2} className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Upcoming fixtures</h2>
        {!upcoming || upcoming.length === 0 ? (
          <div className="kivo-glass rounded-2xl p-6 text-center text-sm text-foreground-muted">
            No upcoming fixtures synced for this competition yet.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {upcoming.map((fixture) => (
              <div key={fixture.id} className="kivo-glass flex items-center justify-between gap-3 rounded-xl p-3 text-sm">
                <span className="truncate text-foreground">
                  {fixture.home_team?.name ?? "Home"} vs {fixture.away_team?.name ?? "Away"}
                </span>
                <span className="shrink-0 text-xs text-foreground-subtle">
                  <LocalDateTime iso={fixture.kickoff_at} format="dayTime" />
                </span>
              </div>
            ))}
          </div>
        )}
      </FadeIn>

      {/* Results sit after the fixtures list: a league page is read forwards
          first ("who plays next") and backwards second. Rendered only when
          there is a real finished match with a real score — an empty
          "Results" heading on a season that has not kicked off yet says
          nothing the fixtures list above has not already said. */}
      {results && results.length > 0 && (
        <FadeIn delay={0.21} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Latest results</h2>
          <div className="flex flex-col gap-2">
            {results.map((fixture) => (
              <Link
                key={fixture.id}
                href={`/matches/${fixture.id}`}
                className="kivo-glass kivo-focus flex items-center justify-between gap-3 rounded-xl p-3 text-sm transition-colors hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {fixture.home_team?.name ?? "Home"} vs {fixture.away_team?.name ?? "Away"}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-foreground">
                  {fixture.home_score} - {fixture.away_score}
                </span>
                <span className="shrink-0 text-xs text-foreground-subtle">
                  <LocalDateTime iso={fixture.kickoff_at} format="dayTime" />
                </span>
              </Link>
            ))}
          </div>
        </FadeIn>
      )}

      {/* Before the coverage panel, because it is content rather than an
          explanation of missing content — and its own empty state already names
          which of "not synced", "this source can't", and "not established" it
          is, using the same registry the panel below reads. */}
      <TopScorersPanel
        competitionId={competition.id}
        seasonId={activeSeason?.id ?? null}
        seasonLabel={activeSeason?.name ?? null}
      />

      {/* KIVO_NEXT_GEN KN-103. Placed after the table and fixtures rather than
          before them: it answers "why is that section empty", which is only a
          question once you have seen the empty section. */}
      {/* Deliberately the CURRENT season, not the one being viewed: this panel
          answers "what can this source do for this competition now", which
          does not change because the reader is looking at an older table. */}
      <CompetitionCoveragePanel competitionId={competition.id} currentSeasonId={currentSeason?.id ?? null} />

      {/* Renders nothing when the season has no placed standings rows, which
          is the honest state for a competition KIVO has fixtures but no table
          for yet. */}
      {activeSeason && (
        <FadeIn delay={0.24} className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
          <ShareCardPanel
            kind="league-table"
            id={activeSeason.id}
            // The card has to be the season on screen. Sharing the current
            // season's table from a page showing 2023/24 would be a real table
            // under the wrong year.
            shareUrl={`/leagues/${competition.id}?season=${activeSeason.id}`}
            shareText={`${competition.name} table on KIVO.`}
            heading="Share the table"
            description="Pick a background. The preview is the exact image you save."
          />
        </FadeIn>
      )}
    </div>
  );
}
