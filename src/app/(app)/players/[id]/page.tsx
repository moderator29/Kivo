import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { UserRound, Shield, Flag, Cake, Activity } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { FadeIn } from "@/components/ui/fade-in";
import { FollowButton } from "@/components/ui/follow-button";
import type { Database } from "@/lib/supabase/types";

type FixtureEventType = Database["public"]["Enums"]["fixture_event_type"];

// A lineup row against a fixture in any of these statuses means the player has
// actually taken the pitch — "scheduled" fixtures don't count as an appearance yet.
const PLAYED_STATUSES = new Set(["live", "halftime", "finished"]);

function calculateAge(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function TeamCrest({ crestUrl, name }: { crestUrl: string | null; name: string }) {
  if (crestUrl) {
    return <Image src={crestUrl} alt={name} width={28} height={28} className="h-7 w-7 shrink-0 object-contain" />;
  }
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/5">
      <Shield className="h-3.5 w-3.5 text-foreground-subtle" strokeWidth={1.75} />
    </div>
  );
}

export default async function PlayerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerSupabaseClient();
  const profile = await getOrCreateProfile();

  const [{ data: player }, { data: lineupRows }, { data: eventRows }, isFollowing] = await Promise.all([
    supabase
      .from("players")
      .select(
        `id, full_name, known_as, date_of_birth, nationality, position, current_team_id,
         current_team:teams(id, name, short_name, crest_url)`,
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("lineups")
      .select("id, is_starting, fixture:fixtures(status)")
      .eq("player_id", id),
    supabase
      .from("fixture_events")
      .select("event_type")
      .eq("player_id", id),
    profile
      ? supabase
          .from("follows")
          .select("id", { count: "exact", head: true })
          .eq("follower_profile_id", profile.id)
          .eq("followed_type", "player")
          .eq("followed_id", id)
          .then(({ count }) => (count ?? 0) > 0)
      : Promise.resolve(false),
  ]);

  if (!player) notFound();

  const appearances = (lineupRows ?? []).filter((l) => l.fixture && PLAYED_STATUSES.has(l.fixture.status));
  const hasMatchData = appearances.length > 0;
  const starts = appearances.filter((l) => l.is_starting).length;

  const countEvents = (types: FixtureEventType[]) =>
    (eventRows ?? []).filter((e) => types.includes(e.event_type)).length;

  const goals = countEvents(["goal", "penalty_goal"]);
  const yellowCards = countEvents(["yellow_card"]);
  const redCards = countEvents(["red_card", "second_yellow_card"]);

  const displayName = player.known_as ?? player.full_name;
  const showFullNameSubtitle = Boolean(player.known_as) && player.known_as !== player.full_name;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn className="kivo-glass rounded-2xl p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white/5">
            <UserRound className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold text-foreground">{displayName}</h1>
            {showFullNameSubtitle && <p className="truncate text-xs text-foreground-subtle">{player.full_name}</p>}
            {player.position && (
              <span className="mt-1 inline-block rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
                {player.position}
              </span>
            )}
          </div>
          {profile && <FollowButton targetType="player" targetId={player.id} initialFollowing={isFollowing} />}
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2 text-sm text-foreground-muted">
            <Flag className="h-4 w-4 shrink-0 text-kivo-cyan" strokeWidth={1.75} />
            {player.nationality ?? "Nationality not yet synced"}
          </div>
          <div className="flex items-center gap-2 text-sm text-foreground-muted">
            <Cake className="h-4 w-4 shrink-0 text-kivo-cyan" strokeWidth={1.75} />
            {player.date_of_birth
              ? `${formatDate(player.date_of_birth)} (age ${calculateAge(player.date_of_birth)})`
              : "Date of birth not yet synced"}
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={0.05} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <Shield className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
          Current club
        </h2>
        {player.current_team ? (
          <Link
            href={`/teams/${player.current_team.id}`}
            className="kivo-glass flex items-center gap-3 rounded-2xl p-4 transition hover:bg-white/5"
          >
            <TeamCrest crestUrl={player.current_team.crest_url} name={player.current_team.name} />
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">{player.current_team.name}</p>
              {player.current_team.short_name && (
                <p className="truncate text-[11px] text-foreground-subtle">{player.current_team.short_name}</p>
              )}
            </div>
          </Link>
        ) : (
          <div className="kivo-glass rounded-2xl p-5 text-center text-sm text-foreground-muted">
            No current club on record.
          </div>
        )}
      </FadeIn>

      <FadeIn delay={0.1} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <Activity className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
          Season stats
        </h2>
        {hasMatchData ? (
          <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-5">
            {[
              ["Apps", appearances.length],
              ["Starts", starts],
              ["Goals", goals],
              ["Yellow", yellowCards],
              ["Red", redCards],
            ].map(([label, value]) => (
              <div key={label as string} className="kivo-glass rounded-xl px-2 py-3">
                <div className="text-lg font-semibold text-foreground">{value}</div>
                <div className="text-[10px] uppercase tracking-wide text-foreground-subtle">{label}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="kivo-glass rounded-2xl p-5 text-center text-sm text-foreground-muted">
            No match data yet.
          </div>
        )}
      </FadeIn>
    </div>
  );
}
