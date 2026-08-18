"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { ArrowUp } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { PostCard } from "@/components/social/post-card";
import { NewPostsWatcher } from "@/components/social/new-posts-watcher";
import { SoftErrorBoundary } from "@/components/ui/soft-error-boundary";
import { loadMorePosts } from "@/app/(app)/social/actions";
import type { PostListItem } from "@/app/(app)/social/posts";

/** `/social`'s post list plus a "Load more" button that appends the next page
 * via `loadMorePosts` — same offset-based shape as `LeaguesList`/`TeamsGrid`
 * (RECOMMENDATIONS item 119: the feed previously had a flat `.limit(50)`
 * with no way to reach older posts). */
export function SocialFeed({
  initialPosts,
  initialHasMore,
  signedIn,
  followingOnly = false,
  scrollToPostId = null,
}: {
  initialPosts: PostListItem[];
  initialHasMore: boolean;
  signedIn: boolean;
  /** RECOMMENDATIONS item 175: threaded through to loadMorePosts so "Load
   * more" keeps respecting the All/Following tab the page was rendered
   * with. */
  followingOnly?: boolean;
  /** RECOMMENDATIONS item 237: a post id to scroll to and briefly highlight
   * on mount — the page.tsx server component has already guaranteed this id
   * is present in `initialPosts` (prepending it if it wasn't on the normal
   * first page), so this only ever needs to scroll, never search pagination
   * for it. */
  scrollToPostId?: string | null;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  // Runs once on mount only — scrollToPostId is a one-shot "where the viewer
  // arrived from" hint from the URL the page loaded with, not something a
  // later prop change should re-trigger a scroll for.
  const [highlightPostId, setHighlightPostId] = useState(scrollToPostId);
  useEffect(() => {
    if (!scrollToPostId) return;
    const el = document.getElementById(`post-${scrollToPostId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    const timeout = setTimeout(() => setHighlightPostId(null), 1600);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // RECOMMENDATIONS.md item 119: real "new posts arrived" signal via
  // Supabase Realtime on `posts` (migration 0042_realtime_posts — the exact
  // pattern src/hooks/use-realtime-fixtures.ts already established for
  // fixtures/fixture_events), not a periodic poll. Never auto-inserts a new
  // post into the list — that would jump content under a reader's cursor —
  // it only flips a dismissible pill the user clicks to reload.
  const [hasNewPosts, setHasNewPosts] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const handleNewPosts = useCallback(() => setHasNewPosts(true), []);

  // The subscription itself lives in NewPostsWatcher behind a
  // SoftErrorBoundary. That split is deliberate and load-bearing: it is the
  // only part of this page that needs a browser Supabase client, and
  // docs/BUG_AUDIT_2026-08-18.md C4 caught /social showing "Something went
  // wrong" — server 200, client throw during hydration — because that client
  // was constructed unconditionally in *this* component, so a feed full of
  // perfectly readable posts died with it. Now the worst case is no pill.
  const realtimeWatcher = (
    <SoftErrorBoundary context="social.newPostsWatcher">
      <NewPostsWatcher
        followingOnly={followingOnly}
        latestCreatedAt={posts[0]?.createdAt ?? null}
        onNewPosts={handleNewPosts}
      />
    </SoftErrorBoundary>
  );

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
        className="kivo-gradient-prime flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold text-on-accent shadow-pop kivo-raise disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />
        {refreshing ? "Loading…" : "New posts"}
      </button>
    </FadeIn>
  );

  if (posts.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {realtimeWatcher}
        {newPostsPill}
        <FadeIn delay={0.12} className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-10 text-center">
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
      {realtimeWatcher}
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
          highlighted={post.id === highlightPostId}
          isSystem={post.isSystem}
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
          className="self-center rounded-xl border border-hairline px-4 py-2 text-xs font-semibold text-foreground-muted transition hover:bg-surface-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
