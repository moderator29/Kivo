import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalDateTime } from "@/components/ui/relative-time";
import { Shield, ArrowLeft } from "lucide-react";
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
import { viewerIsSignedIn } from "@/lib/guest-preview";
import { CompetitionCoveragePanel } from "@/components/football/coverage-panel";

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

export default async function LeagueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerSupabaseClient();
  const profile = await getOrCreateProfile();

  const [{ data: competition }, isFollowing, standingsLastSyncedAt] = await Promise.all([
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

  if (!competition) notFound();

  const currentSeason = competition.seasons?.find((s) => s.is_current) ?? competition.seasons?.[0];

  const { data: standings } = currentSeason
    ? await supabase
        .from("standings")
        .select("team_id, played, won, drawn, lost, goals_for, goals_against, points, position, team:teams(id, name, crest_url)")
        .eq("season_id", currentSeason.id)
        .order("position", { ascending: true })
    : { data: null };

  const { data: upcoming } = currentSeason
    ? await supabase
        .from("fixtures")
        .select(
          `id, kickoff_at, home_team:teams!fixtures_home_team_id_fkey(name, crest_url), away_team:teams!fixtures_away_team_id_fkey(name, crest_url)`,
        )
        .eq("season_id", currentSeason.id)
        .eq("status", "scheduled")
        .gt("kickoff_at", new Date().toISOString())
        .order("kickoff_at", { ascending: true })
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
          <p className="text-xs text-foreground-subtle">
            {competition.country ?? "International"}
            {currentSeason ? ` · ${currentSeason.name}` : ""}
          </p>
        </FadeIn>
        <FadeIn delay={0.1}>
          <FollowButton targetType="competition" targetId={competition.id} initialFollowing={isFollowing} signedIn={viewerIsSignedIn(profile)} />
        </FadeIn>
      </div>

      <FadeIn delay={0.15} className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Standings</h2>
          <LastSyncedNote timestamp={standingsLastSyncedAt} />
        </div>
        {!standings || standings.length === 0 ? (
          <div className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-6 text-center text-sm text-foreground-muted">
            Standings haven&apos;t been synced yet for this competition.
            {currentSeason && canManageFootballData(profile?.role) && (
              <InlineSyncButton
                label="Sync standings"
                action={triggerStandingsSync.bind(null, currentSeason.id)}
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

      {/* KIVO_NEXT_GEN KN-103. Placed after the table and fixtures rather than
          before them: it answers "why is that section empty", which is only a
          question once you have seen the empty section. */}
      <CompetitionCoveragePanel competitionId={competition.id} currentSeasonId={currentSeason?.id ?? null} />

      <FadeIn delay={0.25} className="self-center">
        <Link
          href="/leagues"
          className="flex items-center gap-1 text-xs text-foreground-subtle underline decoration-hairline-strong underline-offset-4 hover:text-foreground-muted"
        >
          <ArrowLeft className="h-3 w-3" strokeWidth={2} />
          Back to leagues
        </Link>
      </FadeIn>
    </div>
  );
}
