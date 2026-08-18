"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { PostCard } from "@/components/social/post-card";
import type { PostListItem } from "@/app/(app)/social/posts";
import { cn } from "@/lib/utils";

/**
 * A run of consecutive posts by one author, drawn as one connected thread.
 *
 * The lead post is an ordinary card. Everything after it sits in a rail whose
 * vertical rule is aligned to the centre of the lead post's avatar, with a
 * short horizontal tick into each continuation card. That alignment is the
 * whole trick and it is why the numbers are literals: the card's own padding
 * is 16px and the avatar is 32px, so the avatar's centre — and therefore the
 * rule — is 32px from the card's left edge.
 *
 * A run longer than two collapses its middle behind "Show N more updates".
 * Newest and oldest stay visible because those are the two a reader wants:
 * what they said last, and what started it.
 *
 * Nothing here is a new kind of content. Every card is the same `PostCard`
 * with the same reactions, comments, polls and save state it has in any other
 * feed — only the author row is dropped on a continuation, because it has
 * already been drawn once above.
 */
export function PostThread({
  posts,
  signedIn,
  startIndex,
  highlightPostId,
}: {
  /** A run of at least two posts, newest first, as `groupPostsIntoThreads`
   * produces. A one-post run is not a thread and the caller renders it as a
   * plain card. */
  posts: PostListItem[];
  signedIn: boolean;
  /** Position of the lead post in the whole feed, so the entrance stagger
   * stays continuous across threads. */
  startIndex: number;
  highlightPostId: string | null;
}) {
  const [expanded, setExpanded] = useState(false);

  const [lead, ...rest] = posts;
  const hiddenCount = rest.length - 1;
  const collapsible = hiddenCount > 0;
  // A deep-linked post inside a collapsed middle would otherwise be scrolled
  // to and then found not to exist. If the highlight is in this run, it opens.
  const forcedOpen = collapsible && posts.some((post) => post.id === highlightPostId && post.id !== lead.id);
  const showAll = expanded || forcedOpen || !collapsible;
  const visibleRest = showAll ? rest : [rest[rest.length - 1]];

  return (
    <div className="flex flex-col">
      <PostCard {...lead} signedIn={signedIn} index={startIndex} highlighted={lead.id === highlightPostId} />

      {collapsible && !showAll && (
        <RailRow marker="node">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="kivo-focus flex items-center gap-1.5 py-2.5 text-xs font-semibold text-foreground-subtle transition-colors hover:text-foreground"
          >
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={2} />
            Show {hiddenCount} more update{hiddenCount === 1 ? "" : "s"}
          </button>
        </RailRow>
      )}

      {visibleRest.map((post, index) => (
        <RailRow key={post.id} marker="tick" last={index === visibleRest.length - 1}>
          <div className="pb-2">
            <PostCard
              {...post}
              continuation
              signedIn={signedIn}
              index={startIndex + index + 1}
              highlighted={post.id === highlightPostId}
            />
          </div>
        </RailRow>
      ))}
    </div>
  );
}

/**
 * One row of the thread: a 44px rail column carrying the rule, then the row's
 * own content.
 *
 * The rule is drawn per row rather than as one absolutely-positioned line over
 * the whole run, so it ends exactly where the last row's tick is instead of
 * dangling past the final card — which is the detail that separates a thread
 * from a card with a stray line next to it.
 */
function RailRow({
  children,
  marker,
  last = false,
}: {
  children: ReactNode;
  /** `tick` reaches into a card; `node` is the dot on the "show more" row. */
  marker: "tick" | "node";
  last?: boolean;
}) {
  return (
    <div className="flex">
      <div className="relative w-11 shrink-0" aria-hidden="true">
        {/* Stops at the tick on the final row; runs the full height otherwise. */}
        <span
          className={cn(
            "absolute left-8 top-0 w-px bg-hairline-strong",
            last ? "h-[1.4rem]" : "bottom-0",
          )}
        />
        {marker === "tick" ? (
          <span className="absolute left-8 top-[1.4rem] h-px w-3 bg-hairline-strong" />
        ) : (
          <span className="absolute left-[calc(2rem-3px)] top-[1.15rem] h-1.5 w-1.5 rounded-full bg-hairline-strong" />
        )}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
