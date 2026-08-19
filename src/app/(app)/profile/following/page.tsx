import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Star, Shield, UserRound, BellOff, Users } from "lucide-react";
import { getOrCreateProfile } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readList } from "@/lib/query-result";
import { LoadFailed } from "@/components/ui/load-failed";
import { FadeIn } from "@/components/ui/fade-in";
import { FollowButton } from "@/components/ui/follow-button";
import { FollowWithMute } from "@/components/ui/follow-with-mute";
import { FOLLOW_MEANING } from "@/lib/follow-meaning";
import { TeamCrest } from "@/components/ui/team-crest";
import { KivoAvatar } from "@/components/ui/kivo-avatar";
import { resolveAvatarSrc } from "@/lib/kivo-assets";

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
type PersonRow = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  avatar_type: "kivo" | "uploaded";
  avatar_kivo_id: string | null;
  avatar_uploaded_url: string | null;
};

export default async function FollowingPage() {
  const profile = await getOrCreateProfile();
  // This page only makes sense for a signed-in profile's own follows (RLS
  // scopes `follows` selects to the caller already) — guests are routed to
  // sign-up rather than shown an empty shell.
  if (!profile) redirect(`/sign-up?redirect_url=${encodeURIComponent("/profile/following")}`);

  const supabase = createServerSupabaseClient();
  // RECOMMENDATIONS.md item 291: no longer filtered to team/player/
  // competition — 'user' rows are this page's own "who this profile follows"
  // half of the new People section, so a single unfiltered query covers all
  // four types instead of adding a fifth query just for the 'user' slice.
  const [followsResult, followerRowsResult] = await Promise.all([
    supabase
      .from("follows")
      // KN-52: `muted` comes back with the row now. The mute control has
      // existed since migration 0049 and been honoured by teamAudience()/
      // playerAudience() ever since, but nothing in the product ever showed a
      // user *what* they had muted — so a club muted three weeks ago was
      // indistinguishable from a club KIVO simply had no news about.
      .select("followed_type, followed_id, created_at, muted")
      .eq("follower_profile_id", profile.id)
      .order("created_at", { ascending: false }),
    // follows_select_own only covers `follower_profile_id = caller` — the
    // reverse direction ("who follows me") has no covering SELECT policy, so
    // this goes through get_my_followers() (migration 0048), a narrow
    // SECURITY DEFINER read scoped to the caller's own incoming follows only.
    supabase.rpc("get_my_followers"),
  ]);

  // This page is a list of the reader's own decisions. "You aren't following
  // anyone yet" is a claim about them, and it is wrong in the way that makes
  // someone re-follow clubs they never stopped following.
  const followsOutcome = readList(followsResult, "following.follows");
  const followersOutcome = readList(followerRowsResult, "following.followers");

  const follows = followsOutcome.rows;
  const followerRows = followersOutcome.rows;

  // id -> muted, for the two types a mute means anything for (team/player).
  const mutedFollowIds = new Set(follows.filter((f) => f.muted).map((f) => f.followed_id));

  const teamIds = follows.filter((f) => f.followed_type === "team").map((f) => f.followed_id);
  const playerIds = follows.filter((f) => f.followed_type === "player").map((f) => f.followed_id);
  const competitionIds = follows.filter((f) => f.followed_type === "competition").map((f) => f.followed_id);
  const followingUserIds = follows.filter((f) => f.followed_type === "user").map((f) => f.followed_id);

  // get_my_followers() has no ORDER BY (a plain set-returning SQL function),
  // so newest-first is applied here rather than trusted from the RPC.
  const followerUserIds = followerRows
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((f) => f.follower_profile_id);

  const peopleIds = Array.from(new Set([...followingUserIds, ...followerUserIds]));

  const [teamsResult, playersResult, competitionsResult, peopleResult] = await Promise.all([
    teamIds.length
      ? supabase.from("teams").select("id, name, short_name, crest_url").in("id", teamIds)
      : Promise.resolve({ data: [] as TeamRow[], error: null }),
    playerIds.length
      ? supabase
          .from("players")
          .select("id, full_name, known_as, position, current_team:teams(name, crest_url)")
          .in("id", playerIds)
      : Promise.resolve({ data: [] as PlayerRow[], error: null }),
    competitionIds.length
      ? supabase.from("competitions").select("id, name, short_name, country").in("id", competitionIds)
      : Promise.resolve({ data: [] as CompetitionRow[], error: null }),
    // profiles has no cross-user SELECT policy — resolved through the same
    // narrow SECURITY DEFINER RPC every other cross-user identity lookup in
    // this codebase already uses (get_public_profiles, migration 0011).
    peopleIds.length
      ? supabase.rpc("get_public_profiles", { p_ids: peopleIds })
      : Promise.resolve({ data: [] as PersonRow[], error: null }),
  ]);

  // Four hydration reads, all gating rather than tolerated. Each one turns an
  // id the page already holds into something it can name; when one fails the
  // id survives and the row it names does not, so the entry disappears from
  // the list entirely. On this page in particular that is indistinguishable
  // from having been unfollowed, which is the one outcome a follow list must
  // never fake.
  const teamsOutcome = readList(teamsResult, "following.teams");
  const playersOutcome = readList(playersResult, "following.players");
  const competitionsOutcome = readList(competitionsResult, "following.competitions");
  const peopleOutcome = readList(peopleResult, "following.people");

  const loadFailed =
    followsOutcome.failed ||
    followersOutcome.failed ||
    teamsOutcome.failed ||
    playersOutcome.failed ||
    competitionsOutcome.failed ||
    peopleOutcome.failed;

  const teamMap = new Map(teamsOutcome.rows.map((t) => [t.id, t]));
  const playerMap = new Map(playersOutcome.rows.map((p) => [p.id, p]));
  const competitionMap = new Map(competitionsOutcome.rows.map((c) => [c.id, c]));
  const personMap = new Map(peopleOutcome.rows.map((p) => [p.id, p]));

  // followed_id has no DB-level FK (it's polymorphic across three tables), so
  // a followed row whose target was since deleted resolves to nothing here —
  // filtered out rather than rendered as a broken link.
  const followedTeams = teamIds.map((id) => teamMap.get(id)).filter((t): t is TeamRow => !!t);
  const followedPlayers = playerIds.map((id) => playerMap.get(id)).filter((p): p is PlayerRow => !!p);
  const followedCompetitions = competitionIds
    .map((id) => competitionMap.get(id))
    .filter((c): c is CompetitionRow => !!c);
  // Same defensive filter as the three above — a profile is hard-deleted
  // (cascading off auth.users via profiles.auth_user_id) when its owner
  // deletes their account, so a stale follow row is a real (if rare) case
  // here too, not just a hypothetical.
  const followingPeople = followingUserIds.map((id) => personMap.get(id)).filter((p): p is PersonRow => !!p);
  const followingPeopleIds = new Set(followingPeople.map((p) => p.id));
  const followerPeople = followerUserIds.map((id) => personMap.get(id)).filter((p): p is PersonRow => !!p);

  // Only team/player follows can be muted (migration 0049) — a competition or
  // user follow has no audience for a mute to exclude you from.
  const mutedCount =
    followedTeams.filter((t) => mutedFollowIds.has(t.id)).length +
    followedPlayers.filter((p) => mutedFollowIds.has(p.id)).length;

  const isEmpty =
    followedTeams.length === 0 &&
    followedPlayers.length === 0 &&
    followedCompetitions.length === 0 &&
    followingPeople.length === 0 &&
    followerPeople.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">Following</h1>
        <p className="text-sm text-foreground-subtle">
          Teams, players and competitions you follow — and the people you follow and who follow you.
        </p>
      </FadeIn>

      {/* KN-51: the permanent home for "what does following actually do".
          The transient confirmation on the star says it at the moment of the
          decision; this is where a user comes back to when they have already
          followed a dozen things and want to know what they signed up for.
          Both read from the same sentences (src/lib/follow-meaning.ts). */}
      {/* The explainer describes what following *does*, and it is only
          meaningful next to a real list. Suppressed on a failed read as well
          as an empty one — it would otherwise sit above a "couldn't load"
          panel explaining the semantics of things nobody can see. */}
      {!isEmpty && !loadFailed && (
        <FadeIn delay={0.03} className="kivo-glass flex flex-col gap-2 rounded-2xl p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">What following does</h2>
          <p className="text-xs leading-relaxed text-foreground-muted">
            <span className="font-medium text-foreground">Clubs:</span> {FOLLOW_MEANING.team}
          </p>
          <p className="text-xs leading-relaxed text-foreground-muted">
            <span className="font-medium text-foreground">Players:</span> {FOLLOW_MEANING.player}
          </p>
          <p className="text-xs leading-relaxed text-foreground-muted">
            <span className="font-medium text-foreground">Competitions:</span> {FOLLOW_MEANING.competition}
          </p>
          {mutedCount > 0 ? (
            <p className="flex items-center gap-1.5 border-t border-hairline-soft pt-2 text-xs text-foreground-muted">
              <BellOff className="h-3.5 w-3.5 shrink-0 text-foreground-subtle" strokeWidth={2} />
              {mutedCount === 1 ? "1 of these is muted" : `${mutedCount} of these are muted`} — marked below, and no
              match alerts reach you for them.
            </p>
          ) : (
            <p className="border-t border-hairline-soft pt-2 text-xs text-foreground-subtle">
              Use the bell on any club or player to mute its alerts without unfollowing.
            </p>
          )}
        </FadeIn>
      )}

      {loadFailed ? (
        <LoadFailed
          tone="section"
          title="Who you follow"
          description="KIVO couldn't read your follows just now. Nothing has been unfollowed — try again."
        />
      ) : isEmpty ? (
        <FadeIn delay={0.05} className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-8 text-center">
          <Star className="h-6 w-6 text-foreground-subtle" strokeWidth={1.75} />
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
          {(followingPeople.length > 0 || followerPeople.length > 0) && (
            <FadeIn delay={0.02} className="flex flex-col gap-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
                <Users className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
                People
              </h2>

              {followingPeople.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-xs font-medium text-foreground-subtle">Following · {followingPeople.length}</h3>
                  <div className="kivo-glass flex flex-col divide-y divide-white/5 rounded-2xl">
                    {followingPeople.map((person) => (
                      <div key={person.id} className="flex items-center gap-3 px-4 py-3">
                        <Link
                          href={`/u/${person.username}`}
                          className="flex min-w-0 flex-1 items-center gap-3 transition-all hover:translate-x-1"
                        >
                          <KivoAvatar src={resolveAvatarSrc(person)} name={person.display_name} size={36} />
                          <div className="min-w-0">
                            <p className="truncate text-sm text-foreground">{person.display_name || person.username}</p>
                            <p className="truncate text-[11px] text-foreground-subtle">@{person.username}</p>
                          </div>
                        </Link>
                        <FollowButton targetType="user" targetId={person.id} initialFollowing size="sm" signedIn />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {followerPeople.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-xs font-medium text-foreground-subtle">Followers · {followerPeople.length}</h3>
                  <div className="kivo-glass flex flex-col divide-y divide-white/5 rounded-2xl">
                    {followerPeople.map((person) => (
                      <div key={person.id} className="flex items-center gap-3 px-4 py-3">
                        <Link
                          href={`/u/${person.username}`}
                          className="flex min-w-0 flex-1 items-center gap-3 transition-all hover:translate-x-1"
                        >
                          <KivoAvatar src={resolveAvatarSrc(person)} name={person.display_name} size={36} />
                          <div className="min-w-0">
                            <p className="truncate text-sm text-foreground">{person.display_name || person.username}</p>
                            <p className="truncate text-[11px] text-foreground-subtle">@{person.username}</p>
                          </div>
                        </Link>
                        <FollowButton
                          targetType="user"
                          targetId={person.id}
                          initialFollowing={followingPeopleIds.has(person.id)}
                          size="sm"
                          signedIn
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </FadeIn>
          )}

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
                      <span className="min-w-0 truncate text-sm text-foreground">{team.name}</span>
                      {mutedFollowIds.has(team.id) && <MutedChip />}
                    </Link>
                    {/* KN-52: the mute toggle itself, not just the star — a
                        list that shows you what you muted but makes you open
                        each club's page to undo it is half a fix. */}
                    <FollowWithMute
                      targetType="team"
                      targetId={team.id}
                      initialFollowing
                      initialMuted={mutedFollowIds.has(team.id)}
                      size="sm"
                      signedIn
                    />
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
                        <p className="flex items-center gap-2 truncate text-sm text-foreground">
                          <span className="truncate">{player.known_as ?? player.full_name}</span>
                          {mutedFollowIds.has(player.id) && <MutedChip />}
                        </p>
                        <p className="truncate text-[11px] text-foreground-subtle">
                          {[player.position, player.current_team?.name].filter(Boolean).join(" · ") || "-"}
                        </p>
                      </div>
                    </Link>
                    <FollowWithMute
                      targetType="player"
                      targetId={player.id}
                      initialFollowing
                      initialMuted={mutedFollowIds.has(player.id)}
                      size="sm"
                      signedIn
                    />
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

/** The one visual mark for a muted follow, so the teams list and the players
 * list can never describe the same state two different ways. */
function MutedChip() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-hairline px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-subtle">
      <BellOff className="h-2.5 w-2.5" strokeWidth={2} />
      Muted
    </span>
  );
}
