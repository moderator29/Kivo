"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { CommentThread } from "@/components/social/comment-thread";
import { PostBody } from "@/components/social/post-body";
import { PollBlock } from "@/components/social/poll-block";
import { PostEntityCard } from "@/components/social/post-entity-card";
import { ReportMenu } from "@/components/social/report-menu";
import { SharePostButton } from "@/components/social/share-post-button";
import { ReactionPicker } from "@/components/social/reaction-picker";
import { SaveButton } from "@/components/ui/save-button";
import { KivoAvatar } from "@/components/ui/kivo-avatar";
import { KivoMarkGlyph } from "@/components/ui/kivo-mark-glyph";
import type { ReactionType } from "@/lib/reactions";
import type { PollSummary, PostFixture } from "@/app/(app)/social/posts";
import { cn } from "@/lib/utils";
import { RelativeTime } from "@/components/ui/relative-time";

interface PostCardProps {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  /** Optional so existing call sites that haven't wired author identity through
   * yet still type-check; the name simply doesn't link without it. */
  authorUsername?: string | null;
  /** Optional for the same reason as authorUsername above — call sites that
   * haven't wired author identity through (Match Room) fall back to the
   * initials badge below rather than needing an update just to type-check. */
  authorAvatarSrc?: string | null;
  reactionCount: number;
  viewerReaction: ReactionType | null;
  commentCount: number;
  signedIn: boolean;
  index?: number;
  /** RECOMMENDATIONS item 172: null for an ordinary post. Optional so
   * existing call sites (Match Room) that don't fetch poll data still
   * type-check — see post-composer.tsx's comment on why polls are hidden
   * there. */
  poll?: PollSummary | null;
  /** RECOMMENDATIONS item 173: defaults false so Match Room's call site
   * (which doesn't fetch save state) still type-checks as "not saved"
   * rather than requiring a change there. */
  viewerSaved?: boolean;
  /** RECOMMENDATIONS item 237: true for one post right after a notification
   * deep-link lands the viewer on it — a brief `.kivo-row-flash` (same cue
   * LiveFixtureList uses for "this row just changed") instead of a bare
   * scroll with zero visual confirmation it found the right post. Defaults
   * false for every ordinary render. */
  highlighted?: boolean;
  /** RECOMMENDATIONS item 254: true only for a KIVO-authored automatic
   * goal/red-card announcement (posts.is_system — see
   * supabase/migrations/0047_match_room_system_posts.sql). When true, the
   * author row below ignores authorName/authorAvatarSrc entirely and always
   * renders the same hardcoded "KIVO" + system badge — so what a post
   * displays as can never be spoofed by whatever happens to be stored in
   * those two fields, only by this boolean, which itself can only ever be
   * true for a real service-role write (RLS rejects it from any client
   * insert/update — see the migration). Defaults false for every ordinary
   * post, general-feed or Room alike. */
  isSystem?: boolean;
  /** The match this post is attached to (`posts.fixture_id`, hydrated by
   * fetchPostsPage). Optional so Match Room's own call site — which is already
   * inside the fixture this would name — keeps type-checking without passing
   * it, and so it renders nothing at all when the post is not about a match. */
  fixture?: PostFixture | null;
  /** True for the second and later posts in a run by the same author.
   *
   * A run of updates from one person is one thought, and repeating their
   * avatar and name above every line of it is what makes a feed read as
   * shouting. A continuation keeps the timestamp — the thing that actually
   * differs between them — and drops the identity, which `PostThread` re-draws
   * once, above the run, as a connector line. */
  continuation?: boolean;
}

export function PostCard({
  id,
  body,
  createdAt,
  authorName,
  authorUsername = null,
  authorAvatarSrc = null,
  reactionCount,
  viewerReaction,
  commentCount,
  signedIn,
  index = 0,
  poll = null,
  viewerSaved = false,
  highlighted = false,
  isSystem = false,
  fixture = null,
  continuation = false,
}: PostCardProps) {
  return (
    <motion.article
      // Anchor target for notification click-through (see postHref() in
      // lib/notification-registry.ts, now `/social?post=<id>` — item 237).
      // scroll-mt clears the sticky TopBar (and, on Match Centre, the sticky
      // score card) so the post the link lands on isn't hidden underneath it.
      id={`post-${id}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index, 6) * 0.04, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2, transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] } }}
      className={cn(
        "kivo-glass scroll-mt-24 flex flex-col gap-3 rounded-2xl p-4 transition-shadow duration-300 hover:shadow-pop",
        highlighted && "kivo-row-flash",
      )}
    >
      {continuation ? (
        <RelativeTime iso={createdAt} className="text-xs text-foreground-subtle" />
      ) : (
      <div className="flex items-center gap-2">
        {isSystem ? (
          <div className="kivo-gradient-prime flex h-8 w-8 shrink-0 items-center justify-center rounded-[28%] ring-1 ring-hairline">
            <KivoMarkGlyph size={20} />
          </div>
        ) : authorAvatarSrc ? (
          <KivoAvatar src={authorAvatarSrc} name={authorName} size={32} className="ring-1 ring-hairline" />
        ) : (
          <KivoAvatar src={null} name={authorName} size={32} className="ring-1 ring-hairline" />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          {isSystem ? (
            <span className="flex w-fit items-center gap-1.5">
              <span className="text-sm font-medium text-foreground">KIVO</span>
              {/* Same pill shape/colour as admin's role badges
                  (ROLE_BADGE_STYLE in src/app/admin/users/page.tsx) — reused
                  here so "official KIVO content" reads as visually distinct
                  from any real fan's name using an already-established
                  design-system cue, not a one-off new badge style. */}
              <span
                title="Automated KIVO match update — not posted by a fan"
                className="inline-flex items-center rounded-full border border-kivo-cyan/30 bg-kivo-cyan/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-kivo-cyan"
              >
                System
              </span>
            </span>
          ) : authorUsername ? (
            <Link
              href={`/u/${authorUsername}`}
              className="w-fit truncate text-sm font-medium text-foreground hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {authorName}
            </Link>
          ) : (
            <span className="truncate text-sm font-medium text-foreground">{authorName}</span>
          )}
          <RelativeTime iso={createdAt} className="text-xs text-foreground-subtle" />
        </div>
      </div>
      )}
      <PostBody body={body} />
      {fixture && <PostEntityCard fixture={fixture} />}
      {poll && <PollBlock postId={id} poll={poll} signedIn={signedIn} />}
      <div className="flex items-center justify-between gap-2">
        <ReactionPicker targetType="post" targetId={id} count={reactionCount} viewerReaction={viewerReaction} signedIn={signedIn} />

        <div className="flex items-center gap-1">
          <SaveButton targetType="post" targetId={id} initialSaved={viewerSaved} signedIn={signedIn} />

          {/* Not gated on sign-in: copying a public post's link is not an
              action on anyone's account, and a guest reading the feed is
              exactly the person most likely to want to send one on. */}
          <SharePostButton postId={id} />

          <ReportMenu targetId={id} signedIn={signedIn} />
        </div>
      </div>

      <CommentThread postId={id} initialCount={commentCount} signedIn={signedIn} />
    </motion.article>
  );
}
