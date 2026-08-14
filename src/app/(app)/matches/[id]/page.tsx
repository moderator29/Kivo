import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Shield, MapPin } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { triggerFixtureDetailsSync } from "@/app/admin/data-health/actions";
import { FadeIn } from "@/components/ui/fade-in";
import { MatchCentreTabs } from "@/components/matches/match-centre-tabs";
import type { Database } from "@/lib/supabase/types";

type FixtureStatus = Database["public"]["Enums"]["fixture_status"];

const STATUS_LABEL: Record<FixtureStatus, string> = {
  scheduled: "Scheduled",
  live: "Live",
  halftime: "HT",
  finished: "FT",
  postponed: "Postponed",
  cancelled: "Cancelled",
  abandoned: "Abandoned",
};

function isLiveStatus(status: FixtureStatus): boolean {
  return status === "live" || status === "halftime";
}

function TeamCrest({ crestUrl, name, size = 20 }: { crestUrl: string | null; name: string; size?: number }) {
  if (crestUrl) {
    return (
      <Image
        src={crestUrl}
        alt={name}
        width={size}
        height={size}
        className="shrink-0 object-contain"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-white/5"
      style={{ width: size, height: size }}
    >
      <Shield className="h-1/2 w-1/2 text-foreground-subtle" strokeWidth={1.75} />
    </div>
  );
}

export default async function MatchCentrePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerSupabaseClient();
  const profile = await getOrCreateProfile();

  const { data: fixture } = await supabase
    .from("fixtures")
    .select(
      `id, kickoff_at, status, home_score, away_score, season_id,
       home_team:teams!fixtures_home_team_id_fkey(id, name, crest_url),
       away_team:teams!fixtures_away_team_id_fkey(id, name, crest_url),
       competition:competitions(name, short_name),
       venue:venues(name, city)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!fixture) notFound();

  const [{ data: events }, { data: lineups }, { data: standings }] = await Promise.all([
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
      .from("standings")
      .select("team_id, played, won, drawn, lost, goals_for, goals_against, points, position, team:teams(name, crest_url)")
      .eq("season_id", fixture.season_id)
      .order("position", { ascending: true }),
  ]);

  const hasScore = fixture.home_score !== null && fixture.away_score !== null;
  const live = isLiveStatus(fixture.status);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn className="kivo-glass sticky top-2 z-10 flex flex-col gap-4 rounded-2xl p-5">
        <div className="flex items-center justify-between text-xs text-foreground-subtle">
          <span>{fixture.competition?.short_name ?? fixture.competition?.name ?? "Unknown competition"}</span>
          {fixture.venue?.name && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" strokeWidth={2} />
              {fixture.venue.name}
              {fixture.venue.city ? `, ${fixture.venue.city}` : ""}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-1 flex-col items-center gap-2">
            <TeamCrest crestUrl={fixture.home_team?.crest_url ?? null} name={fixture.home_team?.name ?? "Home"} size={40} />
            <span className="text-center text-sm font-medium text-foreground">{fixture.home_team?.name ?? "Home team"}</span>
          </div>

          <div className="flex shrink-0 flex-col items-center gap-1">
            <span className="text-2xl font-semibold text-foreground">
              {hasScore ? `${fixture.home_score} – ${fixture.away_score}` : "vs"}
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                live ? "border-live/30 bg-live/10 text-live" : "border-white/10 text-foreground-subtle"
              }`}
            >
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

          <div className="flex flex-1 flex-col items-center gap-2">
            <TeamCrest crestUrl={fixture.away_team?.crest_url ?? null} name={fixture.away_team?.name ?? "Away"} size={40} />
            <span className="text-center text-sm font-medium text-foreground">{fixture.away_team?.name ?? "Away team"}</span>
          </div>
        </div>
      </FadeIn>

      <MatchCentreTabs
        homeTeamId={fixture.home_team?.id ?? ""}
        awayTeamId={fixture.away_team?.id ?? ""}
        canSyncDetails={canManageFootballData(profile?.role)}
        syncDetailsAction={triggerFixtureDetailsSync.bind(null, fixture.id)}
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

      <Link
        href="/matches"
        className="self-center text-xs text-foreground-subtle underline decoration-white/20 underline-offset-4 hover:text-foreground-muted"
      >
        Back to today&apos;s matches
      </Link>
    </div>
  );
}
