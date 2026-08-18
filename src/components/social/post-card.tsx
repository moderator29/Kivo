"use client";

import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Flag, Check } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { reportContent } from "@/app/(app)/social/report-actions";
import { voteOnPoll } from "@/app/(app)/social/actions";
import { CommentThread } from "@/components/social/comment-thread";
import { ReactionPicker } from "@/components/social/reaction-picker";
import { SaveButton } from "@/components/ui/save-button";
import { KivoAvatar } from "@/components/ui/kivo-avatar";
import { KivoMarkGlyph } from "@/components/ui/kivo-mark-glyph";
import { usePopoverPlacement } from "@/hooks/use-popover-placement";
import { GUEST_ACTION_TITLE, GuestLockHint } from "@/components/ui/guest-lock-hint";
import type { ReactionType } from "@/lib/reactions";
import type { PollSummary } from "@/app/(app)/social/posts";
import { cn } from "@/lib/utils";
import { RelativeTime } from "@/components/ui/relative-time";

const REPORT_REASONS = ["Spam", "Harassment or abuse", "Misinformation", "Inappropriate content", "Other"] as const;

// Matches bare http(s) URLs; the capturing group means String.split() keeps the
// matched substrings in the result, alternating with the surrounding plain text.
const URL_PATTERN = /(https?:\/\/[^\s]+)/g;
// Trailing punctuation that's almost always sentence punctuation rather than
// part of the URL itself (e.g. "check this out: https://kivo.app." -> the
// period shouldn't be swallowed into the href).
const TRAILING_PUNCTUATION = /[),.;:!?'"\]}]+$/;

/**
 * Splits a post body into plain-text and link segments for safe rendering.
 * Never builds HTML strings - each URL becomes a real React <a> element, so
 * JSX escaping (not string concatenation) is what keeps this XSS-safe.
 */
function linkifyBody(body: string) {
  const parts = body.split(URL_PATTERN);
  return parts.map((part, i) => {
    // split() with a single capturing group alternates plain text (even
    // indices) with matched URLs (odd indices).
    if (i % 2 === 0 || !part) return part;
    const trailingMatch = part.match(TRAILING_PUNCTUATION);
    const trailing = trailingMatch ? trailingMatch[0] : "";
    const url = trailing ? part.slice(0, -trailing.length) : part;
    if (!url) return part;
    return (
      <Fragment key={i}>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline underline-offset-2 hover:text-accent/80"
        >
          {url}
        </a>
        {trailing}
      </Fragment>
    );
  });
}

function PostBody({ body }: { body: string }) {
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const bodyRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    function measure() {
      if (!el) return;
      setIsOverflowing(el.scrollHeight - el.clientHeight > 1);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [body]);

  return (
    <div className="flex flex-col items-start gap-1">
      <p
        ref={bodyRef}
        className={cn(
          "whitespace-pre-wrap text-sm leading-relaxed text-foreground",
          // Tailwind needs the full class name literal in source to generate it,
          // so this can't be built from a dynamic line-count constant.
          !expanded && "line-clamp-5",
        )}
      >
        {linkifyBody(body)}
      </p>
      {(isOverflowing || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="text-xs font-medium text-accent hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

/**
 * RECOMMENDATIONS.md item 172: real, live vote counts (get_poll_results via
 * fetchPostsPage) with the viewer's own pick highlighted. Bars are always
 * visible — voting isn't gated behind seeing results first — and tapping
 * any option (including the viewer's current one, to change it) calls
 * voteOnPoll, which is delete-then-insert server-side. Optimistic update
 * with rollback on error, same shape as PredictionCard's handlePick.
 */
function PollBlock({ postId, poll, signedIn }: { postId: string; poll: PollSummary; signedIn: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [localPoll, setLocalPoll] = useState(poll);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleVote(optionId: string) {
    if (!signedIn) {
      router.push(`/sign-up?redirect_url=${encodeURIComponent(pathname)}`);
      return;
    }
    if (pending || optionId === localPoll.viewerOptionId) return;
    setError(null);
    const previous = localPoll;
    const previousOptionId = localPoll.viewerOptionId;
    setLocalPoll((current) => ({
      totalVotes: previousOptionId ? current.totalVotes : current.totalVotes + 1,
      viewerOptionId: optionId,
      options: current.options.map((option) => {
        if (option.id === optionId) return { ...option, voteCount: option.voteCount + 1 };
        if (option.id === previousOptionId) return { ...option, voteCount: Math.max(0, option.voteCount - 1) };
        return option;
      }),
    }));
    startTransition(async () => {
      const result = await voteOnPoll(postId, optionId);
      if (result.error) {
        setLocalPoll(previous);
        setError(result.error);
      }
    });
  }

  const total = localPoll.totalVotes;

  return (
    <div className="flex flex-col gap-2">
      {localPoll.options.map((option) => {
        const pct = total > 0 ? Math.round((option.voteCount / total) * 100) : 0;
        const isOwn = option.id === localPoll.viewerOptionId;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => handleVote(option.id)}
            disabled={pending}
            aria-busy={pending}
            aria-pressed={isOwn}
            title={!signedIn ? GUEST_ACTION_TITLE : undefined}
            className={cn(
              "relative overflow-hidden rounded-xl border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed",
              isOwn ? "border-accent/50" : "border-hairline hover:bg-surface-2",
            )}
          >
            <span className="absolute inset-y-0 left-0 bg-accent-soft" style={{ width: `${pct}%` }} aria-hidden="true" />
            <span className="relative flex items-center justify-between gap-2">
              <span className={cn("flex min-w-0 items-center gap-1 truncate", isOwn ? "font-semibold text-foreground" : "text-foreground-muted")}>
                {isOwn && <Check className="h-3 w-3 shrink-0" strokeWidth={2.5} />}
                <span className="truncate">{option.label}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-foreground-subtle">
                {/* RECOMMENDATIONS item 235 */}
                <GuestLockHint show={!signedIn} className="h-2.5 w-2.5 shrink-0" />
                {pct}%
              </span>
            </span>
          </button>
        );
      })}
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-foreground-subtle">
          {total} vote{total === 1 ? "" : "s"}
        </p>
        {error && (
          <p className="text-[11px] text-critical" role="status" aria-live="polite">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

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
}: PostCardProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [reportMenuOpen, setReportMenuOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const [justReported, setJustReported] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportPending, startReportTransition] = useTransition();
  const reportMenuRef = useRef<HTMLDivElement>(null);
  const reportTriggerRef = useRef<HTMLButtonElement>(null);

  // RECOMMENDATIONS item 238: real viewport-edge collision detection for the
  // report-reason popover, which used to always render `right-0 bottom-full`
  // regardless of how close the trigger sat to the top of the viewport.
  // Estimated size covers the header row plus REPORT_REASONS.length rows in
  // the w-48 panel below.
  const reportMenuPlacement = usePopoverPlacement(reportMenuOpen, reportMenuRef, {
    estimatedHeight: 40 + REPORT_REASONS.length * 32,
    estimatedWidth: 192,
    defaultVertical: "top",
    defaultHorizontal: "right",
  });

  useEffect(() => {
    if (!justReported) return;
    const timeout = setTimeout(() => setJustReported(false), 1600);
    return () => clearTimeout(timeout);
  }, [justReported]);

  useEffect(() => {
    if (!reportMenuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (reportMenuRef.current && !reportMenuRef.current.contains(e.target as Node)) setReportMenuOpen(false);
    }
    // Audit item 4: role="menu" popovers previously had no keyboard way to
    // close short of activating an item or tabbing past them. Escape closes
    // and returns focus to the trigger, matching the reaction picker below.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setReportMenuOpen(false);
        reportTriggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [reportMenuOpen]);

  function handleReportClick() {
    if (!signedIn) {
      router.push(`/sign-up?redirect_url=${encodeURIComponent(pathname)}`);
      return;
    }
    if (reported || reportPending) return;
    setReportMenuOpen((open) => !open);
  }

  function submitReport(reason: string) {
    if (reported || reportPending) return;
    setReportError(null);
    startReportTransition(async () => {
      const result = await reportContent("post", id, reason);
      if (result.error) {
        setReportError(result.error);
        return;
      }
      setReported(true);
      setJustReported(true);
      setReportMenuOpen(false);
    });
  }

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
      <div className="flex items-center gap-2">
        {isSystem ? (
          <div className="kivo-gradient-prime flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ring-hairline">
            <KivoMarkGlyph size={20} />
          </div>
        ) : authorAvatarSrc ? (
          <KivoAvatar src={authorAvatarSrc} name={authorName} size={32} className="ring-1 ring-hairline" />
        ) : (
          <div className="kivo-gradient-prime flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-on-accent ring-1 ring-hairline">
            {authorName.charAt(0).toUpperCase()}
          </div>
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
      <PostBody body={body} />
      {poll && <PollBlock postId={id} poll={poll} signedIn={signedIn} />}
      <div className="flex items-center justify-between gap-2">
        <ReactionPicker targetType="post" targetId={id} count={reactionCount} viewerReaction={viewerReaction} signedIn={signedIn} />

        <div className="flex items-center gap-1">
          <SaveButton targetType="post" targetId={id} initialSaved={viewerSaved} signedIn={signedIn} />

          <div ref={reportMenuRef} className="relative">
          <motion.button
            ref={reportTriggerRef}
            type="button"
            onClick={handleReportClick}
            disabled={reported || reportPending}
            aria-haspopup={signedIn ? "menu" : undefined}
            aria-expanded={reportMenuOpen}
            aria-label={reported ? "Reported" : "Report post"}
            title={!signedIn ? GUEST_ACTION_TITLE : undefined}
            whileTap={reported ? undefined : { scale: 0.88 }}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed",
              reported ? "text-foreground-subtle" : "text-foreground-subtle hover:text-critical",
            )}
          >
            <AnimatePresence mode="wait" initial={false}>
              {justReported ? (
                <motion.span
                  key="reported"
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.6 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className="flex items-center gap-1 text-live"
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                  Reported
                </motion.span>
              ) : (
                <motion.span key="flag" className="flex items-center gap-1.5">
                  <Flag className="h-3.5 w-3.5" strokeWidth={1.75} fill={reported ? "currentColor" : "none"} />
                  {reported ? "Reported" : "Report"}
                  {/* RECOMMENDATIONS item 235 */}
                  <GuestLockHint show={!signedIn} className="h-3 w-3 shrink-0 text-foreground-subtle" />
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>

          <AnimatePresence>
            {reportMenuOpen && (
              <motion.div
                role="menu"
                aria-label="Report reason"
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                className={cn(
                  "kivo-popover absolute z-20 w-48 overflow-hidden rounded-xl p-1",
                  reportMenuPlacement.vertical === "top" ? "bottom-full mb-2" : "top-full mt-2",
                  reportMenuPlacement.horizontal === "right" ? "right-0" : "left-0",
                )}
              >
                <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                  Report this post
                </p>
                {REPORT_REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    role="menuitem"
                    disabled={reportPending}
                    aria-busy={reportPending}
                    onClick={() => submitReport(reason)}
                    className="kivo-menu-item text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
                  >
                    {reason}
                  </button>
                ))}
                {reportError && (
                  <p className="px-2.5 py-1.5 text-[11px] text-critical" role="status" aria-live="polite">
                    {reportError}
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        </div>
      </div>

      <CommentThread postId={id} initialCount={commentCount} signedIn={signedIn} />
    </motion.article>
  );
}
