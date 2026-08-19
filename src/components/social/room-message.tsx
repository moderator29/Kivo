"use client";

import { motion } from "motion/react";
import { CommentThread } from "@/components/social/comment-thread";
import { PostBody } from "@/components/social/post-body";
import { PollBlock } from "@/components/social/poll-block";
import { ReactionPicker } from "@/components/social/reaction-picker";
import { ReportMenu } from "@/components/social/report-menu";
import { SharePostButton } from "@/components/social/share-post-button";
import { KivoAvatar } from "@/components/ui/kivo-avatar";
import { RelativeTime } from "@/components/ui/relative-time";
import { parseRoomEventPost, type RoomEvent } from "@/lib/room-event-post";
import type { PollSummary } from "@/app/(app)/social/posts";
import type { ReactionType } from "@/lib/reactions";
import { cn } from "@/lib/utils";

/**
 * One line of a live match room.
 *
 * WHY THIS IS NOT A PostCard
 * ---------------------------------------------------------------------------
 * The Room used to render the general feed's card for every message. A card is
 * right for a considered take you scroll past on `/social`; it is wrong for a
 * room during a match. Measured on a 390px phone, a card carries roughly two
 * hundred pixels of avatar, padding, glass, shadow and a five-line action row
 * for a message that is often four words — three messages a screen, in the one
 * moment on KIVO where the conversation is moving faster than anything else in
 * the product.
 *
 * This is the same content at chat density: no card, no glass, no shadow, one
 * hairline-free row on the page itself. About three times as much of the room
 * fits on a phone, and — the part that matters more — the eye reads it as a
 * conversation rather than as a stack of documents. `CONTAINER_ROLES` calls
 * this a Row, and says a row "inherits the card's corners and is separated by
 * a hairline, never by its own box".
 *
 * WHY A GOAL IS NOT A MESSAGE
 * ---------------------------------------------------------------------------
 * KIVO posts its own goal and red-card announcements into every Room
 * (migration 0047). Rendering those as one more grey message with an avatar
 * beside it is precisely how a football product ends up looking like a generic
 * timeline: the single most important thing that happens in ninety minutes
 * arrives looking exactly like "lol". Here they are parsed back into the event
 * they announce (see src/lib/room-event-post.ts) and drawn as a scoreboard
 * line — minute first, then the moment — that interrupts the chat the way a
 * goal interrupts a match. Nothing is invented: every field is a substring of
 * a body KIVO's own sync wrote, and a body the parser does not recognise falls
 * back to plain text rather than being dressed up.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * ---------------------------------------------------------------------------
 * Save. A Room post's saved state is not fetched by the Room, so a bookmark
 * drawn hollow would be a claim KIVO cannot make — and "keep this for later"
 * is not what anyone wants from a message during a match anyway. Reacting,
 * replying, sharing and reporting all stay, because those are what a room is
 * for and because reporting is how moderation is reached.
 */
export function RoomMessage({
  id,
  body,
  createdAt,
  authorName,
  authorAvatarSrc = null,
  reactionCount,
  viewerReaction,
  commentCount,
  signedIn,
  index = 0,
  poll = null,
  highlighted = false,
  isSystem = false,
}: {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  authorAvatarSrc?: string | null;
  reactionCount: number;
  viewerReaction: ReactionType | null;
  commentCount: number;
  signedIn: boolean;
  index?: number;
  poll?: PollSummary | null;
  highlighted?: boolean;
  /** RECOMMENDATIONS item 254: true only for a KIVO-authored automatic
   * goal/red-card announcement. Like PostCard, this render never trusts
   * authorName/authorAvatarSrc when it is set — a system post can only be
   * created by a real service-role write (see the migration's RLS comment). */
  isSystem?: boolean;
}) {
  const event = isSystem ? parseRoomEventPost(body) : null;

  return (
    <motion.article
      id={`post-${id}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, delay: Math.min(index, 6) * 0.02, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "scroll-mt-24 -mx-2 flex flex-col gap-1.5 rounded-xl px-2 py-2 transition-colors",
        highlighted && "kivo-row-flash",
      )}
    >
      {isSystem ? (
        <RoomEventLine event={event} body={body} createdAt={createdAt} />
      ) : (
        <div className="flex items-start gap-2.5">
          <KivoAvatar src={authorAvatarSrc} name={authorName} size={28} className="mt-0.5 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {/* Name and time on one line with the body directly under it —
                the two-line header a card uses is a line of vertical space per
                message, paid for in how much of the room you can see. */}
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-[13px] font-semibold text-foreground">{authorName}</span>
              <RelativeTime iso={createdAt} className="shrink-0 text-[11px] text-foreground-subtle" />
            </div>
            <PostBody body={body} lines={3} />
          </div>
        </div>
      )}

      {poll && (
        <div className={cn("flex flex-col gap-2", isSystem ? "" : "pl-[38px]")}>
          <PollBlock postId={id} poll={poll} signedIn={signedIn} />
        </div>
      )}

      {/* Aligned under the body, not under the avatar, so a column of messages
          reads as one column of text with its controls tucked beneath. */}
      <div className={cn("flex items-center gap-1", isSystem ? "" : "pl-[38px]")}>
        <ReactionPicker
          targetType="post"
          targetId={id}
          count={reactionCount}
          viewerReaction={viewerReaction}
          signedIn={signedIn}
          size="sm"
        />
        <CommentThread postId={id} initialCount={commentCount} signedIn={signedIn} />
        <span className="flex-1" />
        <SharePostButton postId={id} />
        <ReportMenu targetId={id} signedIn={signedIn} compact />
      </div>
    </motion.article>
  );
}

/**
 * A real match event, drawn as one.
 *
 * The minute sits in its own fixed slot on the left, tabular so a column of
 * events lines up the way a scoreboard does. `event` is null when the body did
 * not parse, and the fallback keeps the KIVO identity and the raw words rather
 * than guessing at fields — see parseRoomEventPost for why that direction is
 * the only safe one.
 */
function RoomEventLine({
  event,
  body,
  createdAt,
}: {
  event: RoomEvent | null;
  body: string;
  createdAt: string;
}) {
  if (!event) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-hairline bg-surface-2 px-3 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">KIVO</span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{body}</span>
        <RelativeTime iso={createdAt} className="shrink-0 text-[11px] text-foreground-subtle" />
      </div>
    );
  }

  const isGoal = event.kind === "goal";

  return (
    <div
      className={cn(
        "flex items-center gap-3 overflow-hidden rounded-xl border px-3 py-2.5",
        isGoal ? "border-accent/35 bg-accent-soft" : "border-hairline-strong bg-surface-2",
      )}
    >
      {/* `tabular-nums` is scoped to the digits alone: applied to the whole
          slot it also widens the prime mark to a full digit cell, which reads
          as "67 '" rather than "67'". */}
      <span
        className={cn(
          "w-11 shrink-0 text-right text-sm font-semibold",
          isGoal ? "text-accent" : "text-foreground-muted",
        )}
      >
        <span className="tabular-nums">{event.minute}</span>&apos;
      </span>
      {isGoal ? <BallGlyph className="h-4 w-4 shrink-0 text-accent" /> : <RedCardGlyph className="h-4 w-4 shrink-0" />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold text-foreground">{event.playerName}</span>
        <span className="truncate text-[11px] text-foreground-subtle">
          {isGoal ? "Goal" : "Sent off"} · {event.teamName}
        </span>
      </span>
    </div>
  );
}

/** A ball, drawn rather than imported — lucide has no football, and this is
 * the one glyph in the room that has to say "football" at a glance. */
function BallGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" strokeLinecap="round" />
      <path d="M12 7.5 8.6 10l1.3 4h4.2l1.3-4z" strokeLinejoin="round" />
      <path d="M12 3v4.5M8.6 10 4.3 8.6M9.9 14l-2.6 3.6M14.1 14l2.6 3.6M15.4 10l4.3-1.4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The card itself, at the angle a referee holds one.
 *
 * Deliberately its own shape rather than `text-critical`: that token means "a
 * real failure or a destructive action" (see DESIGN's status group), and a
 * sending-off is neither. It is a football object, and football objects are
 * what this layer should be made of.
 */
function RedCardGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="7" y="3" width="10" height="15" rx="1.5" fill="#e0243a" transform="rotate(12 12 12)" />
    </svg>
  );
}
