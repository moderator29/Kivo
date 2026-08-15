"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import kivoSocialArtwork from "../../../public/brand/kivo-artwork-social.webp";
import { FadeIn } from "@/components/ui/fade-in";
import { PostCard } from "@/components/social/post-card";
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

  if (posts.length === 0) {
    return (
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
    );
  }

  return (
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
          signedIn={signedIn}
          index={index}
          poll={post.poll}
          viewerSaved={post.viewerSaved}
        />
      ))}

      {error && <p className="text-center text-xs text-critical">{error}</p>}

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
