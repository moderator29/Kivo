import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Shield, ArrowLeft } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { triggerStandingsSync } from "@/app/admin/data-health/actions";
import { FadeIn } from "@/components/ui/fade-in";
import { FollowButton } from "@/components/ui/follow-button";
import { InlineSyncButton } from "@/components/admin/inline-sync-button";
import { LastSyncedNote } from "@/components/football/last-synced-note";
import { TrackView } from "@/components/ui/track-view";
import { getLastSyncedAt } from "@/lib/football/last-synced";

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
          {competition.logo_url ? (
            <Image src={competition.logo_url} alt={competition.name} width={36} height={36} className="h-9 w-9 shrink-0 object-contain" />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5">
              <Shield className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
            </div>
          )}
        </FadeIn>
        <FadeIn delay={0.05} className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-foreground">{competition.name}</h1>
          <p className="text-xs text-foreground-subtle">
            {competition.country ?? "International"}
            {currentSeason ? ` · ${currentSeason.name}` : ""}
          </p>
        </FadeIn>
        <FadeIn delay={0.1}>
          <FollowButton targetType="competition" targetId={competition.id} initialFollowing={isFollowing} signedIn={!!profile} />
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
          <div className="kivo-glass overflow-hidden rounded-2xl">
            <div className="grid grid-cols-[2rem_1fr_2rem_2rem_2rem_2rem] gap-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-foreground-subtle">
              <span>#</span>
              <span>Team</span>
              <span className="text-right">P</span>
              <span className="text-right">GD</span>
              <span className="text-right">Pts</span>
              <span></span>
            </div>
            {standings.map((row) => (
              <Link
                key={row.team_id}
                href={row.team?.id ? `/teams/${row.team.id}` : "#"}
                className="grid grid-cols-[2rem_1fr_2rem_2rem_2rem_2rem] items-center gap-2 px-3 py-2 text-xs transition-all hover:translate-x-1 hover:bg-white/5"
              >
                <span className="text-foreground-subtle">{row.position ?? "-"}</span>
                <span className="flex items-center gap-2 truncate text-foreground">
                  {row.team?.crest_url ? (
                    <Image src={row.team.crest_url} alt={row.team.name} width={16} height={16} className="shrink-0 object-contain" />
                  ) : (
                    <Shield className="h-4 w-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
                  )}
                  <span className="truncate">{row.team?.name ?? "Unknown team"}</span>
                </span>
                <span className="text-right text-foreground-muted">{row.played}</span>
                <span className="text-right text-foreground-muted">{row.goals_for - row.goals_against}</span>
                <span className="text-right font-semibold text-foreground">{row.points}</span>
                <span />
              </Link>
            ))}
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
                  {new Date(fixture.kickoff_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </FadeIn>

      <FadeIn delay={0.25} className="self-center">
        <Link
          href="/leagues"
          className="flex items-center gap-1 text-xs text-foreground-subtle underline decoration-white/20 underline-offset-4 hover:text-foreground-muted"
        >
          <ArrowLeft className="h-3 w-3" strokeWidth={2} />
          Back to leagues
        </Link>
      </FadeIn>
    </div>
  );
}
