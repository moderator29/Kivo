import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Star, Shield, UserRound, ArrowLeft } from "lucide-react";
import { getOrCreateProfile } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { FadeIn } from "@/components/ui/fade-in";
import { FollowButton } from "@/components/ui/follow-button";
import { TeamCrest } from "@/components/ui/team-crest";

export const metadata: Metadata = { title: "Following" };

type TeamRow = { id: string; name: string; short_name: string | null; crest_url: string | null };
type PlayerRow = {
  id: string;
  full_name: string;
  known_as: string | null;
  position: string | null;
  current_team: { name: string; crest_url: string | null } | null;
};
type CompetitionRow = { id: string; name: string; short_name: string | null; country: string | null };

export default async function FollowingPage() {
  const profile = await getOrCreateProfile();
  // This page only makes sense for a signed-in profile's own follows (RLS
  // scopes `follows` selects to the caller already) — guests are routed to
  // sign-up rather than shown an empty shell.
  if (!profile) redirect(`/sign-up?redirect_url=${encodeURIComponent("/profile/following")}`);

  const supabase = createServerSupabaseClient();
  const { data: follows } = await supabase
    .from("follows")
    .select("followed_type, followed_id, created_at")
    .eq("follower_profile_id", profile.id)
    .in("followed_type", ["team", "player", "competition"])
    .order("created_at", { ascending: false });

  const teamIds = (follows ?? []).filter((f) => f.followed_type === "team").map((f) => f.followed_id);
  const playerIds = (follows ?? []).filter((f) => f.followed_type === "player").map((f) => f.followed_id);
  const competitionIds = (follows ?? []).filter((f) => f.followed_type === "competition").map((f) => f.followed_id);

  const [{ data: teams }, { data: players }, { data: competitions }] = await Promise.all([
    teamIds.length
      ? supabase.from("teams").select("id, name, short_name, crest_url").in("id", teamIds)
      : Promise.resolve({ data: [] as TeamRow[] }),
    playerIds.length
      ? supabase
          .from("players")
          .select("id, full_name, known_as, position, current_team:teams(name, crest_url)")
          .in("id", playerIds)
      : Promise.resolve({ data: [] as PlayerRow[] }),
    competitionIds.length
      ? supabase.from("competitions").select("id, name, short_name, country").in("id", competitionIds)
      : Promise.resolve({ data: [] as CompetitionRow[] }),
  ]);

  const teamMap = new Map((teams ?? []).map((t) => [t.id, t]));
  const playerMap = new Map((players ?? []).map((p) => [p.id, p]));
  const competitionMap = new Map((competitions ?? []).map((c) => [c.id, c]));

  // followed_id has no DB-level FK (it's polymorphic across three tables), so
  // a followed row whose target was since deleted resolves to nothing here —
  // filtered out rather than rendered as a broken link.
  const followedTeams = teamIds.map((id) => teamMap.get(id)).filter((t): t is TeamRow => !!t);
  const followedPlayers = playerIds.map((id) => playerMap.get(id)).filter((p): p is PlayerRow => !!p);
  const followedCompetitions = competitionIds
    .map((id) => competitionMap.get(id))
    .filter((c): c is CompetitionRow => !!c);

  const isEmpty = followedTeams.length === 0 && followedPlayers.length === 0 && followedCompetitions.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn className="flex flex-col gap-1">
        <Link
          href="/profile"
          className="flex items-center gap-1 text-xs text-foreground-subtle hover:text-foreground-muted"
        >
          <ArrowLeft className="h-3 w-3" strokeWidth={2} />
          Back to profile
        </Link>
        <h1 className="text-xl font-semibold text-foreground">Following</h1>
        <p className="text-sm text-foreground-subtle">Teams, players and competitions you follow.</p>
      </FadeIn>

      {isEmpty ? (
        <FadeIn delay={0.05} className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-8 text-center">
          <Star className="h-6 w-6 text-foreground-subtle" strokeWidth={1.5} />
          <p className="text-sm text-foreground-muted">
            You&apos;re not following anything yet. Tap the star on a team, player or competition page to follow it.
          </p>
          <Link
            href="/teams"
            className="kivo-gradient-prime rounded-xl px-4 py-2 text-sm font-semibold text-on-accent kivo-raise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Browse teams
          </Link>
        </FadeIn>
      ) : (
        <>
          {followedTeams.length > 0 && (
            <FadeIn delay={0.05} className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
                Teams · {followedTeams.length}
              </h2>
              <div className="kivo-glass flex flex-col divide-y divide-hairline-soft rounded-2xl">
                {followedTeams.map((team) => (
                  <div key={team.id} className="flex items-center gap-3 px-4 py-3">
                    <Link
                      href={`/teams/${team.id}`}
                      className="flex min-w-0 flex-1 items-center gap-3 transition-all hover:translate-x-1"
                    >
                      <TeamCrest crestUrl={team.crest_url} name={team.name} />
                      <span className="truncate text-sm text-foreground">{team.name}</span>
                    </Link>
                    <FollowButton targetType="team" targetId={team.id} initialFollowing size="sm" signedIn />
                  </div>
                ))}
              </div>
            </FadeIn>
          )}

          {followedPlayers.length > 0 && (
            <FadeIn delay={0.1} className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
                Players · {followedPlayers.length}
              </h2>
              <div className="kivo-glass flex flex-col divide-y divide-hairline-soft rounded-2xl">
                {followedPlayers.map((player) => (
                  <div key={player.id} className="flex items-center gap-3 px-4 py-3">
                    <Link
                      href={`/players/${player.id}`}
                      className="flex min-w-0 flex-1 items-center gap-3 transition-all hover:translate-x-1"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2">
                        <UserRound className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">{player.known_as ?? player.full_name}</p>
                        <p className="truncate text-[11px] text-foreground-subtle">
                          {[player.position, player.current_team?.name].filter(Boolean).join(" · ") || "-"}
                        </p>
                      </div>
                    </Link>
                    <FollowButton targetType="player" targetId={player.id} initialFollowing size="sm" signedIn />
                  </div>
                ))}
              </div>
            </FadeIn>
          )}

          {followedCompetitions.length > 0 && (
            <FadeIn delay={0.15} className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
                Competitions · {followedCompetitions.length}
              </h2>
              <div className="kivo-glass flex flex-col divide-y divide-hairline-soft rounded-2xl">
                {followedCompetitions.map((competition) => (
                  <div key={competition.id} className="flex items-center gap-3 px-4 py-3">
                    <Link
                      href={`/leagues/${competition.id}`}
                      className="flex min-w-0 flex-1 items-center gap-3 transition-all hover:translate-x-1"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2">
                        <Shield className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">{competition.name}</p>
                        <p className="truncate text-[11px] text-foreground-subtle">
                          {competition.country ?? "International"}
                        </p>
                      </div>
                    </Link>
                    <FollowButton
                      targetType="competition"
                      targetId={competition.id}
                      initialFollowing
                      size="sm"
                      signedIn
                    />
                  </div>
                ))}
              </div>
            </FadeIn>
          )}
        </>
      )}
    </div>
  );
}
