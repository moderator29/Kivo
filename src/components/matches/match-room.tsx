"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { RoomComposer } from "@/components/matches/room-composer";
import { PostCard } from "@/components/social/post-card";
import { useRealtimeRoomPosts } from "@/hooks/use-realtime-room-posts";
import kivoActionArtwork from "../../../public/brand/kivo-artwork-action.webp";
import type { ReactionType } from "@/lib/reactions";

export type RoomPost = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  authorAvatarSrc: string | null;
  reactionCount: number;
  viewerReaction: ReactionType | null;
  commentCount: number;
  /** RECOMMENDATIONS item 254: true only for a KIVO-authored automatic
   * goal/red-card announcement — see PostCard's isSystem prop. */
  isSystem: boolean;
};

/**
 * Fixture-scoped feed for Match Centre's "Room" tab. Same PostCard /
 * CommentThread / reactions infrastructure as the general `/social` feed
 * (see src/app/(app)/social/page.tsx), just filtered to `posts.fixture_id`.
 * `initialPosts` is fetched server-side in matches/[id]/page.tsx and handed
 * down as plain, already-serialized data for the first paint; from then on
 * useRealtimeRoomPosts (RECOMMENDATIONS item 1) merges in every new post —
 * a fan's own, or a system goal/red-card announcement (item 2) — the
 * instant it's inserted, for every viewer currently on this tab, no
 * manual refresh or click required. See that hook's own doc comment for why
 * Room auto-appends instead of reusing /social's click-to-reveal pill.
 */
export function MatchRoomTab({
  fixtureId,
  signedIn,
  posts: initialPosts,
  scrollToPostId = null,
}: {
  fixtureId: string;
  signedIn: boolean;
  posts: RoomPost[];
  /** RECOMMENDATIONS item 237: a post id to scroll to and briefly highlight
   * on mount — MatchCentrePage has already guaranteed this id is present in
   * `posts` before this component ever renders. */
  scrollToPostId?: string | null;
}) {
  const posts = useRealtimeRoomPosts(fixtureId, initialPosts);

  // Same one-shot scroll + fade-highlight as SocialFeed's own
  // scrollToPostId handling (src/components/social/social-feed.tsx) — kept
  // as a separate small effect here rather than factored into a shared hook,
  // since the two host different DOM shapes (posts vs. Room posts) and each
  // is only a few lines.
  const [highlightPostId, setHighlightPostId] = useState(scrollToPostId);
  useEffect(() => {
    if (!scrollToPostId) return;
    const el = document.getElementById(`post-${scrollToPostId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    const timeout = setTimeout(() => setHighlightPostId(null), 1600);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <RoomComposer signedIn={signedIn} fixtureId={fixtureId} />

      {posts.length === 0 ? (
        <div className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-10 text-center">
          {/* Second use of kivo-artwork-action.webp (also on Home's header —
              see src/app/(app)/home/page.tsx for the trademark check it went
              through). This is the one commissioned piece reused twice: its
              live tackle-and-save action reads naturally on both the general
              dashboard and here, a single fixture's own room, before anyone's
              posted. Same edge-masked, floating treatment as the hero. */}
          <div className="kivo-artwork-float kivo-artwork-mask relative h-32 w-52 sm:h-40 sm:w-64">
            <Image src={kivoActionArtwork} alt="" fill className="object-contain" sizes="256px" />
          </div>
          <p className="text-sm text-foreground-muted">
            No one&apos;s posted in this match room yet. Be the first.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {posts.map((post, index) => (
            <PostCard
              key={post.id}
              id={post.id}
              body={post.body}
              createdAt={post.createdAt}
              authorName={post.authorName}
              authorAvatarSrc={post.authorAvatarSrc}
              reactionCount={post.reactionCount}
              viewerReaction={post.viewerReaction}
              commentCount={post.commentCount}
              signedIn={signedIn}
              index={index}
              highlighted={post.id === highlightPostId}
              isSystem={post.isSystem}
            />
          ))}
        </div>
      )}
    </div>
  );
}
