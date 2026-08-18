import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Bookmark, UserRound } from "lucide-react";
import { getOrCreateProfile } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { FadeIn } from "@/components/ui/fade-in";
import { TeamCrest } from "@/components/ui/team-crest";
import { SaveButton } from "@/components/ui/save-button";
import { PostCard } from "@/components/social/post-card";
import { fetchPostsPage } from "@/app/(app)/social/posts";
import { WatchlistDigestPanel } from "@/components/football/watchlist-digest-panel";

export const metadata: Metadata = { title: "Saved" };

type TeamRow = { id: string; name: string; short_name: string | null; crest_url: string | null };
type PlayerRow = {
  id: string;
  full_name: string;
  known_as: string | null;
  position: string | null;
  current_team: { name: string; crest_url: string | null } | null;
};

/**
 * RECOMMENDATIONS item 173: mirrors /profile/following's shape (own-row
 * saves_select_own query, split by target_type, hydrate each type's real
 * rows, drop anything whose target was since deleted rather than rendering
 * a broken link) — saved posts additionally go through fetchPostsPage so
 * they render as full, interactive PostCards (reactions, comments, polls),
 * not a stripped-down summary.
 */
export default async function SavedPage() {
  const profile = await getOrCreateProfile();
  if (!profile) redirect(`/sign-up?redirect_url=${encodeURIComponent("/saved")}`);

  const supabase = createServerSupabaseClient();
  const { data: saves } = await supabase
    .from("saves")
    .select("target_type, target_id, created_at")
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false });

  const postIds = (saves ?? []).filter((s) => s.target_type === "post").map((s) => s.target_id);
  const teamIds = (saves ?? []).filter((s) => s.target_type === "team").map((s) => s.target_id);
  const playerIds = (saves ?? []).filter((s) => s.target_type === "player").map((s) => s.target_id);

  const [{ posts, error: postsError }, { data: teams }, { data: players }] = await Promise.all([
    fetchPostsPage(0, profile.id, { postIds }),
    teamIds.length
      ? supabase.from("teams").select("id, name, short_name, crest_url").in("id", teamIds)
      : Promise.resolve({ data: [] as TeamRow[] }),
    playerIds.length
      ? supabase
          .from("players")
          .select("id, full_name, known_as, position, current_team:teams(name, crest_url)")
          .in("id", playerIds)
      : Promise.resolve({ data: [] as PlayerRow[] }),
  ]);

  const teamMap = new Map((teams ?? []).map((t) => [t.id, t]));
  const playerMap = new Map((players ?? []).map((p) => [p.id, p]));

  // target_id has no DB-level FK (it's polymorphic across three tables, same
  // caveat as follows) — a saved row whose target was since deleted resolves
  // to nothing here and is filtered out rather than rendered as a broken link.
  const savedTeams = teamIds.map((id) => teamMap.get(id)).filter((t): t is TeamRow => !!t);
  const savedPlayers = playerIds.map((id) => playerMap.get(id)).filter((p): p is PlayerRow => !!p);

  const isEmpty = posts.length === 0 && savedTeams.length === 0 && savedPlayers.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn className="flex flex-col gap-1">
        <Link href="/profile" className="flex items-center gap-1 text-xs text-foreground-subtle hover:text-foreground-muted">
          <ArrowLeft className="h-3 w-3" strokeWidth={2} />
          Back to profile
        </Link>
        <h1 className="text-xl font-semibold text-foreground">Saved</h1>
        <p className="text-sm text-foreground-subtle">Posts, teams and players you&apos;ve saved.</p>
      </FadeIn>

      {/* KIVO_NEXT_GEN KN-106: what actually changed, above the list of what you
          bookmarked. Renders nothing at all when nothing is watched. Placed
          above the empty-state branch on purpose: someone can follow teams
          without ever saving anything, and their digest is still real. */}
      <WatchlistDigestPanel profileId={profile.id} />

      {isEmpty ? (
        <FadeIn delay={0.05} className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-8 text-center">
          <Bookmark className="h-6 w-6 text-foreground-subtle" strokeWidth={1.75} />
          <p className="text-sm text-foreground-muted">
            Nothing saved yet. Tap the bookmark icon on a post, team or player page to save it here.
          </p>
        </FadeIn>
      ) : (
        <>
          {savedTeams.length > 0 && (
            <FadeIn delay={0.05} className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
                Teams · {savedTeams.length}
              </h2>
              <div className="kivo-glass flex flex-col divide-y divide-hairline-soft rounded-2xl">
                {savedTeams.map((team) => (
                  <div key={team.id} className="flex items-center gap-3 px-4 py-3">
                    <Link href={`/teams/${team.id}`} className="flex min-w-0 flex-1 items-center gap-3 transition-all hover:translate-x-1">
                      <TeamCrest crestUrl={team.crest_url} name={team.name} />
                      <span className="truncate text-sm text-foreground">{team.name}</span>
                    </Link>
                    <SaveButton targetType="team" targetId={team.id} initialSaved size="sm" signedIn />
                  </div>
                ))}
              </div>
            </FadeIn>
          )}

          {savedPlayers.length > 0 && (
            <FadeIn delay={0.1} className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
                Players · {savedPlayers.length}
              </h2>
              <div className="kivo-glass flex flex-col divide-y divide-hairline-soft rounded-2xl">
                {savedPlayers.map((player) => (
                  <div key={player.id} className="flex items-center gap-3 px-4 py-3">
                    <Link href={`/players/${player.id}`} className="flex min-w-0 flex-1 items-center gap-3 transition-all hover:translate-x-1">
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
                    <SaveButton targetType="player" targetId={player.id} initialSaved size="sm" signedIn />
                  </div>
                ))}
              </div>
            </FadeIn>
          )}

          {postsError && <p className="text-center text-xs text-critical">{postsError}</p>}

          {posts.length > 0 && (
            <FadeIn delay={0.15} className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
                Posts · {posts.length}
              </h2>
              <div className="flex flex-col gap-3">
                {posts.map((post, index) => (
                  <PostCard
                    key={post.id}
                    id={post.id}
                    body={post.body}
                    createdAt={post.createdAt}
                    authorName={post.authorName}
                    authorUsername={post.authorUsername}
                    reactionCount={post.reactionCount}
                    viewerReaction={post.viewerReaction}
                    commentCount={post.commentCount}
                    signedIn
                    index={index}
                    poll={post.poll}
                    viewerSaved={post.viewerSaved}
                    isSystem={post.isSystem}
                  />
                ))}
              </div>
            </FadeIn>
          )}
        </>
      )}
    </div>
  );
}
