import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Shield, MapPin, Trophy, Users, UserRound, CalendarClock, History } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { triggerTeamSquadSync } from "@/app/admin/data-health/actions";
import { FadeIn } from "@/components/ui/fade-in";
import { FollowButton } from "@/components/ui/follow-button";
import { InlineSyncButton } from "@/components/admin/inline-sync-button";
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

function formatKickoff(kickoffAt: string): string {
  return new Date(kickoffAt).toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadgeText(status: FixtureStatus, kickoffAt: string): string {
  if (status === "scheduled") return formatKickoff(kickoffAt);
  return STATUS_LABEL[status];
}

function calculateAge(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

const POSITION_GROUPS = ["Goalkeepers", "Defenders", "Midfielders", "Forwards", "Other"] as const;
type PositionGroup = (typeof POSITION_GROUPS)[number];

function positionGroup(position: string | null): PositionGroup {
  if (!position) return "Other";
  const p = position.toLowerCase();
  if (p.includes("keeper") || p === "gk") return "Goalkeepers";
  if (p.includes("back") || p.includes("defen") || p === "df") return "Defenders";
  if (p.includes("mid") || p === "mf") return "Midfielders";
  if (p.includes("forward") || p.includes("striker") || p.includes("wing") || p === "fw" || p === "st") {
    return "Forwards";
  }
  return "Other";
}

function TeamCrest({ crestUrl, name, size = 28 }: { crestUrl: string | null; name: string; size?: number }) {
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

type FixtureRow = {
  id: string;
  kickoff_at: string;
  status: FixtureStatus;
  home_score: number | null;
  away_score: number | null;
  competition: { name: string; short_name: string | null } | null;
  home_team: { id: string; name: string; short_name: string | null; crest_url: string | null } | null;
  away_team: { id: string; name: string; short_name: string | null; crest_url: string | null } | null;
};

function FixtureListItem({ fixture, teamId }: { fixture: FixtureRow; teamId: string }) {
  const isHome = fixture.home_team?.id === teamId;
  const own = isHome ? fixture.home_team : fixture.away_team;
  const opponent = isHome ? fixture.away_team : fixture.home_team;
  const hasScore = fixture.home_score !== null && fixture.away_score !== null;
  const live = isLiveStatus(fixture.status);

  let resultClass = "text-foreground-muted";
  if (fixture.status === "finished" && hasScore) {
    const ownScore = isHome ? fixture.home_score! : fixture.away_score!;
    const oppScore = isHome ? fixture.away_score! : fixture.home_score!;
    if (ownScore > oppScore) resultClass = "text-live";
    else if (ownScore < oppScore) resultClass = "text-critical";
    else resultClass = "text-foreground-muted";
  }

  return (
    <div className="kivo-glass flex items-center justify-between gap-3 rounded-2xl p-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="w-4 shrink-0 text-[10px] font-semibold uppercase text-foreground-subtle">
          {isHome ? "H" : "A"}
        </span>
        <TeamCrest crestUrl={opponent?.crest_url ?? null} name={opponent?.name ?? "Opponent"} />
        <div className="min-w-0">
          {opponent?.id ? (
            <Link
              href={`/teams/${opponent.id}`}
              className="block truncate text-sm text-foreground hover:text-kivo-cyan"
            >
              {opponent.name}
            </Link>
          ) : (
            <span className="block truncate text-sm text-foreground">{opponent?.name ?? "Unknown opponent"}</span>
          )}
          <span className="text-[11px] text-foreground-subtle">
            {fixture.competition?.short_name ?? fixture.competition?.name ?? "Unknown competition"}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            live
              ? "border-live/30 bg-live/10 text-live"
              : fixture.status === "finished"
                ? "border-white/10 text-foreground-subtle"
                : "border-white/10 text-foreground-muted"
          }`}
        >
          {statusBadgeText(fixture.status, fixture.kickoff_at)}
        </span>
        {hasScore && (
          <span className={`text-sm font-semibold ${resultClass}`}>
            {own?.id === fixture.home_team?.id ? `${fixture.home_score} – ${fixture.away_score}` : `${fixture.away_score} – ${fixture.home_score}`}
          </span>
        )}
      </div>
    </div>
  );
}

export default async function TeamProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerSupabaseClient();
  const profile = await getOrCreateProfile();

  const [{ data: team }, { data: standingsRows }, { data: squad }, { data: managers }, { data: upcoming }, { data: recent }, isFollowing] =
    await Promise.all([
      supabase
        .from("teams")
        .select(
          `id, name, short_name, country, founded_year, crest_url, venue_id,
           venue:venues(name, city, country, capacity)`,
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("standings")
        .select(
          `played, won, drawn, lost, goals_for, goals_against, points, position,
           season:seasons(id, name, is_current, competition:competitions(id, name, short_name))`,
        )
        .eq("team_id", id),
      supabase
        .from("players")
        .select("id, full_name, known_as, position, nationality")
        .eq("current_team_id", id)
        .order("full_name", { ascending: true }),
      supabase
        .from("managers")
        .select("id, full_name, nationality, date_of_birth")
        .eq("current_team_id", id)
        .limit(1),
      supabase
        .from("fixtures")
        .select(
          `id, kickoff_at, status, home_score, away_score,
           competition:competitions(name, short_name),
           home_team:teams!fixtures_home_team_id_fkey(id, name, short_name, crest_url),
           away_team:teams!fixtures_away_team_id_fkey(id, name, short_name, crest_url)`,
        )
        .or(`home_team_id.eq.${id},away_team_id.eq.${id}`)
        .eq("status", "scheduled")
        .order("kickoff_at", { ascending: true })
        .limit(10),
      supabase
        .from("fixtures")
        .select(
          `id, kickoff_at, status, home_score, away_score,
           competition:competitions(name, short_name),
           home_team:teams!fixtures_home_team_id_fkey(id, name, short_name, crest_url),
           away_team:teams!fixtures_away_team_id_fkey(id, name, short_name, crest_url)`,
        )
        .or(`home_team_id.eq.${id},away_team_id.eq.${id}`)
        .eq("status", "finished")
        .order("kickoff_at", { ascending: false })
        .limit(10),
      profile
        ? supabase
            .from("follows")
            .select("id", { count: "exact", head: true })
            .eq("follower_profile_id", profile.id)
            .eq("followed_type", "team")
            .eq("followed_id", id)
            .then(({ count }) => (count ?? 0) > 0)
        : Promise.resolve(false),
    ]);

  if (!team) notFound();

  const currentStanding = (standingsRows ?? []).find((s) => s.season?.is_current) ?? null;
  const manager = managers?.[0] ?? null;

  const squadByGroup = new Map<PositionGroup, NonNullable<typeof squad>>();
  for (const group of POSITION_GROUPS) squadByGroup.set(group, []);
  for (const player of squad ?? []) {
    squadByGroup.get(positionGroup(player.position))!.push(player);
  }
  const hasSquad = (squad?.length ?? 0) > 0;

  const metaParts = [team.country, team.founded_year ? `Founded ${team.founded_year}` : null].filter(Boolean);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn className="kivo-glass-brand rounded-2xl p-6">
        <div className="flex items-center gap-4">
          <TeamCrest crestUrl={team.crest_url} name={team.name} size={56} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold text-foreground">{team.name}</h1>
            {metaParts.length > 0 && <p className="text-xs text-foreground-subtle">{metaParts.join(" · ")}</p>}
          </div>
          {profile && <FollowButton targetType="team" targetId={team.id} initialFollowing={isFollowing} />}
        </div>
        {team.venue ? (
          <div className="mt-4 flex items-start gap-2 text-xs text-foreground-muted">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-kivo-cyan" strokeWidth={1.75} />
            <span>
              {team.venue.name}
              {team.venue.city ? `, ${team.venue.city}` : ""}
              {team.venue.capacity ? ` · Capacity ${team.venue.capacity.toLocaleString()}` : ""}
            </span>
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-2 text-xs text-foreground-subtle">
            <MapPin className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            <span>Venue not yet synced</span>
          </div>
        )}
      </FadeIn>

      <FadeIn delay={0.05} className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <Trophy className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
          League position
        </h2>
        {currentStanding ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold text-foreground">
                {currentStanding.position !== null ? `#${currentStanding.position}` : "–"}
              </span>
              <span className="text-xs text-foreground-subtle">
                {currentStanding.season?.competition?.short_name ?? currentStanding.season?.competition?.name} ·{" "}
                {currentStanding.season?.name}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center sm:grid-cols-7">
              {[
                ["P", currentStanding.played],
                ["W", currentStanding.won],
                ["D", currentStanding.drawn],
                ["L", currentStanding.lost],
                ["GF", currentStanding.goals_for],
                ["GA", currentStanding.goals_against],
                ["PTS", currentStanding.points],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-xl bg-white/5 px-2 py-2">
                  <div className="text-sm font-semibold text-foreground">{value}</div>
                  <div className="text-[10px] uppercase tracking-wide text-foreground-subtle">{label}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-foreground-muted">Standings not yet synced for this team.</p>
        )}
      </FadeIn>

      <FadeIn delay={0.1} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <UserRound className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
          Manager
        </h2>
        {manager ? (
          <div className="kivo-glass flex items-center gap-3 rounded-2xl p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/5">
              <UserRound className="h-5 w-5 text-foreground-subtle" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-sm text-foreground">{manager.full_name}</p>
              <p className="text-[11px] text-foreground-subtle">
                {[manager.nationality, manager.date_of_birth ? `Age ${calculateAge(manager.date_of_birth)}` : null]
                  .filter(Boolean)
                  .join(" · ") || "No further details on record"}
              </p>
            </div>
          </div>
        ) : (
          <div className="kivo-glass rounded-2xl p-5 text-center text-sm text-foreground-muted">
            No manager on record yet.
          </div>
        )}
      </FadeIn>

      <FadeIn delay={0.15} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <Users className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
          Squad
        </h2>
        {hasSquad ? (
          <div className="flex flex-col gap-4">
            {POSITION_GROUPS.map((group) => {
              const players = squadByGroup.get(group) ?? [];
              if (players.length === 0) return null;
              return (
                <div key={group} className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                    {group}
                  </span>
                  <div className="kivo-glass flex flex-col divide-y divide-white/5 rounded-2xl">
                    {players.map((player) => (
                      <Link
                        key={player.id}
                        href={`/players/${player.id}`}
                        className="flex items-center gap-3 px-4 py-3 transition hover:bg-white/5"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5">
                          <UserRound className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm text-foreground">{player.known_as ?? player.full_name}</p>
                          <p className="truncate text-[11px] text-foreground-subtle">
                            {[player.position, player.nationality].filter(Boolean).join(" · ") || "—"}
                          </p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-5 text-center text-sm text-foreground-muted">
            Squad not yet synced for this team.
            {canManageFootballData(profile?.role) && (
              <InlineSyncButton label="Sync squad" action={triggerTeamSquadSync.bind(null, team.id)} />
            )}
          </div>
        )}
      </FadeIn>

      <FadeIn delay={0.2} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <CalendarClock className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
          Upcoming fixtures
        </h2>
        {upcoming && upcoming.length > 0 ? (
          <div className="flex flex-col gap-2">
            {upcoming.map((fixture) => (
              <FixtureListItem key={fixture.id} fixture={fixture} teamId={team.id} />
            ))}
          </div>
        ) : (
          <div className="kivo-glass rounded-2xl p-5 text-center text-sm text-foreground-muted">
            No upcoming fixtures scheduled yet.
          </div>
        )}
      </FadeIn>

      <FadeIn delay={0.25} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <History className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
          Recent results
        </h2>
        {recent && recent.length > 0 ? (
          <div className="flex flex-col gap-2">
            {recent.map((fixture) => (
              <FixtureListItem key={fixture.id} fixture={fixture} teamId={team.id} />
            ))}
          </div>
        ) : (
          <div className="kivo-glass rounded-2xl p-5 text-center text-sm text-foreground-muted">
            No results synced yet.
          </div>
        )}
      </FadeIn>
    </div>
  );
}
