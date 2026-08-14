"use client";

import { Radio } from "lucide-react";
import { PostComposer } from "@/components/social/post-composer";
import { PostCard } from "@/components/social/post-card";

export type RoomPost = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  likeCount: number;
  likedByViewer: boolean;
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
          <Radio className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
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
              likeCount={post.likeCount}
              likedByViewer={post.likedByViewer}
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
