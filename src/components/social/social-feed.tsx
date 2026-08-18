"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { ArrowUp } from "lucide-react";
import kivoSocialArtwork from "../../../public/brand/kivo-artwork-social.webp";
import { FadeIn } from "@/components/ui/fade-in";
import { PostCard } from "@/components/social/post-card";
import { loadMorePosts } from "@/app/(app)/social/actions";
import type { PostListItem } from "@/app/(app)/social/posts";
import { useSupabaseClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/types";

/** `/social`'s post list plus a "Load more" button that appends the next page
 * via `loadMorePosts` — same offset-based shape as `LeaguesList`/`TeamsGrid`
 * (RECOMMENDATIONS item 119: the feed previously had a flat `.limit(50)`
 * with no way to reach older posts). */
export function SocialFeed({
  initialPosts,
  initialHasMore,
  signedIn,
  followingOnly = false,
}: {
  initialPosts: PostListItem[];
  initialHasMore: boolean;
  signedIn: boolean;
  /** RECOMMENDATIONS item 175: threaded through to loadMorePosts so "Load
   * more" keeps respecting the All/Following tab the page was rendered
   * with. */
  followingOnly?: boolean;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const supabase = useSupabaseClient();

  // RECOMMENDATIONS.md item 119: real "new posts arrived" signal via
  // Supabase Realtime on `posts` (migration 0042_realtime_posts — the exact
  // pattern src/hooks/use-realtime-fixtures.ts already established for
  // fixtures/fixture_events), not a periodic poll. Never auto-inserts a new
  // post into the list — that would jump content under a reader's cursor —
  // it only flips a dismissible pill the user clicks to reload.
  const [hasNewPosts, setHasNewPosts] = useState(false);
  const [refreshing, startRefresh] = useTransition();

  // Synced after every commit (not read/written during render) so the
  // realtime subscription below — which only ever mounts once — always sees
  // the current newest-loaded timestamp without needing to resubscribe every
  // time `posts` changes.
  const latestCreatedAtRef = useRef(posts[0]?.createdAt ?? null);
  useEffect(() => {
    latestCreatedAtRef.current = posts[0]?.createdAt ?? null;
  }, [posts]);

  // Only populated for the "Following" tab — the viewer's own followed
  // author ids, read once via the browser client so RLS (`follows_select_own`)
  // scopes it to the signed-in viewer automatically. Used to decide whether
  // an INSERT the realtime channel sees is actually relevant to this tab,
  // the same filter fetchPostsPage already applies server-side for the
  // initial page.
  const followedAuthorIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!followingOnly) {
      followedAuthorIdsRef.current = null;
      return;
    }
    let cancelled = false;
    supabase
      .from("follows")
      .select("followed_id")
      .eq("followed_type", "user")
      .then(({ data }) => {
        if (!cancelled) followedAuthorIdsRef.current = new Set((data ?? []).map((f) => f.followed_id));
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, followingOnly]);

  useEffect(() => {
    const channel = supabase
      .channel("posts-feed")
      .on<Database["public"]["Tables"]["posts"]["Row"]>(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posts" },
        (payload) => {
          const inserted = payload.new;
          const newest = latestCreatedAtRef.current;
          if (newest && new Date(inserted.created_at).getTime() <= new Date(newest).getTime()) return;
          if (followingOnly) {
            const followed = followedAuthorIdsRef.current;
            if (!followed || !followed.has(inserted.author_profile_id)) return;
          }
          setHasNewPosts(true);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, followingOnly]);

  function handleLoadMore() {
    setError(null);
    startLoading(async () => {
      const result = await loadMorePosts(posts.length, { followingOnly });
      if (result.error) {
        setError(result.error);
        return;
      }
      setPosts((prev) => [...prev, ...result.posts]);
      setHasMore(result.hasMore);
    });
  }

  // Reloads the first page from the top rather than merging the realtime
  // payload directly — a bare INSERT event doesn't carry the reaction/
  // comment/poll joins fetchPostsPage assembles, so this stays the single
  // source of truth for what a post card actually renders.
  function handleShowNewPosts() {
    setError(null);
    startRefresh(async () => {
      const result = await loadMorePosts(0, { followingOnly });
      if (result.error) {
        setError(result.error);
        return;
      }
      setPosts(result.posts);
      setHasMore(result.hasMore);
      setHasNewPosts(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  const newPostsPill = hasNewPosts && (
    <FadeIn className="sticky top-16 z-30 flex justify-center">
      <button
        type="button"
        onClick={handleShowNewPosts}
        disabled={refreshing}
        className="kivo-gradient-prime flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold text-kivo-white shadow-lg transition-opacity disabled:opacity-60"
      >
        <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />
        {refreshing ? "Loading…" : "New posts"}
      </button>
    </FadeIn>
  );

  if (posts.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {newPostsPill}
        <FadeIn delay={0.12} className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-10 text-center">
          {/* Last of the three commissioned KIVO artwork pieces placed off the
              landing page this session (see the hero's placement comment in
              src/app/page.tsx for the trademark check they went through) — its
              running players and social UI cards fit a community empty state
              better than the generic Users icon alone. Same edge-masked,
              floating treatment as the hero; only shown when there's genuinely
              nothing else on screen, so it never crowds a real feed. */}
          <div className="kivo-artwork-float kivo-artwork-mask relative h-36 w-56 sm:h-44 sm:w-72">
            <Image src={kivoSocialArtwork} alt="" fill className="object-contain" sizes="288px" />
          </div>
          <p className="text-sm text-foreground-muted">
            {followingOnly
              ? "Nobody you follow has posted yet. Follow a user from their profile to see their posts here."
              : "Nobody's posted yet. Be the first to share your take on the game."}
          </p>
        </FadeIn>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {newPostsPill}
      {posts.map((post, index) => (
        <PostCard
          key={post.id}
          id={post.id}
          body={post.body}
          createdAt={post.createdAt}
          authorName={post.authorName}
          authorUsername={post.authorUsername}
          authorAvatarSrc={post.authorAvatarSrc}
          reactionCount={post.reactionCount}
          viewerReaction={post.viewerReaction}
          commentCount={post.commentCount}
          signedIn={signedIn}
          index={index}
          poll={post.poll}
          viewerSaved={post.viewerSaved}
        />
      ))}

      {error && (
        <p className="text-center text-xs text-critical" role="status" aria-live="polite">
          {error}
        </p>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={loading}
          className="self-center rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-foreground-muted transition hover:bg-white/5 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
