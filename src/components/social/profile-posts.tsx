"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { PostCard } from "@/components/social/post-card";
import { PostThread } from "@/components/social/post-thread";
import { groupPostsIntoThreads } from "@/lib/social-threads";
import { loadMoreProfilePosts } from "@/app/(app)/social/actions";
import type { PostListItem } from "@/app/(app)/social/posts";

/**
 * What somebody has actually said, on their own profile.
 *
 * A public profile used to show a person's XP and their badges and not one
 * word they had written — a Follow button above a page that never answered
 * what following them would get you. On a football platform that is the wrong
 * way round: the takes are the person, and the badges are what the takes
 * earned.
 *
 * Same cards as the feed, deliberately. A post is the same object wherever it
 * is read, and it carries its match here too, so a profile full of Match Room
 * posts reads as a record of the matches this fan turns up for.
 */
export function ProfilePosts({
  authorProfileId,
  authorName,
  initialPosts,
  initialHasMore,
  initialCursor,
  signedIn,
  isOwnProfile,
}: {
  authorProfileId: string;
  /** For the empty state's copy. Someone else's quiet profile and your own
   * are different situations and get different sentences. */
  authorName: string;
  initialPosts: PostListItem[];
  initialHasMore: boolean;
  initialCursor: { createdAt: string; id: string } | null;
  signedIn: boolean;
  isOwnProfile: boolean;
}) {
  const [posts, setPosts] = useState(initialPosts);
  const [cursor, setCursor] = useState(initialCursor);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  function handleLoadMore() {
    setError(null);
    startLoading(async () => {
      const result = await loadMoreProfilePosts(authorProfileId, cursor ?? undefined);
      if (result.error) {
        setError(result.error);
        return;
      }
      setCursor(result.nextCursor);
      setPosts((previous) => {
        const seen = new Set(previous.map((post) => post.id));
        return [...previous, ...result.posts.filter((post) => !seen.has(post.id))];
      });
      setHasMore(result.hasMore);
    });
  }

  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-hairline px-6 py-10 text-center">
        <p className="text-sm text-foreground-muted">
          {isOwnProfile
            ? "You haven't posted yet. Your takes show up here, and in the room of whatever match they're about."
            : `${authorName} hasn't posted yet.`}
        </p>
        {isOwnProfile && (
          <Link
            href="/social/compose"
            className="kivo-gradient-prime kivo-raise kivo-focus rounded-xl px-4 py-2 text-sm font-semibold text-on-accent"
          >
            Write your first take
          </Link>
        )}
      </div>
    );
  }

  // Same run-grouping as the feed: four posts in ten minutes from one person
  // is one train of thought, and on a profile — where every post is by the
  // same person — that matters more, not less.
  const threads = groupPostsIntoThreads(posts);
  const indexById = new Map(posts.map((post, index) => [post.id, index]));

  return (
    <div className="flex flex-col gap-3">
      {threads.map((thread) => {
        const startIndex = indexById.get(thread[0].id) ?? 0;
        if (thread.length === 1) {
          return <PostCard key={thread[0].id} {...thread[0]} signedIn={signedIn} index={startIndex} />;
        }
        return (
          <PostThread
            key={thread[0].id}
            posts={thread}
            signedIn={signedIn}
            startIndex={startIndex}
            highlightPostId={null}
          />
        );
      })}

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
          className="kivo-focus self-center rounded-xl border border-hairline px-4 py-2 text-xs font-semibold text-foreground-muted transition hover:bg-surface-2 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
