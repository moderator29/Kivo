"use client";

import Image from "next/image";
import { PostComposer } from "@/components/social/post-composer";
import { PostCard } from "@/components/social/post-card";
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
};

/**
 * Fixture-scoped feed for Match Centre's "Room" tab. Same PostCard /
 * CommentThread / reactions infrastructure as the general `/social` feed
 * (see src/app/(app)/social/page.tsx), just filtered to `posts.fixture_id`.
 * `posts` is fetched server-side in matches/[id]/page.tsx and handed down
 * as plain, already-serialized data — this component itself stays
 * client-side only for the composer/like/comment interactivity.
 */
export function MatchRoomTab({
  fixtureId,
  signedIn,
  posts,
}: {
  fixtureId: string;
  signedIn: boolean;
  posts: RoomPost[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <PostComposer signedIn={signedIn} fixtureId={fixtureId} placeholder="What's happening in this match?" />

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
            />
          ))}
        </div>
      )}
    </div>
  );
}
