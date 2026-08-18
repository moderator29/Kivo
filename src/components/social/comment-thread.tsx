"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { MessageCircle, CornerDownRight } from "lucide-react";
import { getComments, createComment, type CommentDTO } from "@/app/(app)/social/comment-actions";
import { KivoAvatar } from "@/components/ui/kivo-avatar";
import { ReactionPicker } from "@/components/social/reaction-picker";
import { GUEST_ACTION_TITLE, GuestLockHint } from "@/components/ui/guest-lock-hint";
import { RelativeTime } from "@/components/ui/relative-time";

const MAX_COMMENT_INPUT_LENGTH = 1000;

function CommentItem({
  comment,
  signedIn,
  onReply,
}: {
  comment: CommentDTO;
  signedIn: boolean;
  onReply?: () => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <KivoAvatar src={comment.authorAvatarSrc} name={comment.authorName} size={20} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2">
          {comment.authorUsername ? (
            <Link
              href={`/u/${comment.authorUsername}`}
              className="text-xs font-medium text-foreground hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {comment.authorName}
            </Link>
          ) : (
            <span className="text-xs font-medium text-foreground">{comment.authorName}</span>
          )}
          <RelativeTime iso={comment.createdAt} className="text-[11px] text-foreground-subtle" />
        </div>
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground-muted">{comment.body}</p>
        <div className="flex items-center gap-1">
          {/* Audit item 6: ReactionPicker was already built with a size="sm"
              variant for exactly this row, but no comment ever rendered one. */}
          <ReactionPicker
            targetType="comment"
            targetId={comment.id}
            count={comment.reactionCount}
            viewerReaction={comment.viewerReaction}
            signedIn={signedIn}
            size="sm"
          />
          {onReply && (
            <button
              type="button"
              onClick={onReply}
              className="w-fit text-[11px] font-medium text-foreground-subtle transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              Reply
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function CommentThread({
  postId,
  initialCount,
  signedIn,
}: {
  postId: string;
  initialCount: number;
  signedIn: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const formRef = useRef<HTMLFormElement>(null);

  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [comments, setComments] = useState<CommentDTO[]>([]);
  const [count, setCount] = useState(initialCount);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadPending, startLoadTransition] = useTransition();

  const [replyTo, setReplyTo] = useState<{ id: string; authorName: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitPending, startSubmitTransition] = useTransition();

  function handleToggle() {
    if (!expanded && !loaded && !loadPending) {
      startLoadTransition(async () => {
        const result = await getComments(postId);
        if (result.error) {
          setLoadError(result.error);
        } else {
          setComments(result.comments);
          setLoaded(true);
        }
      });
    }
    setExpanded((v) => !v);
  }

  function handleSubmit(formData: FormData) {
    if (!signedIn) {
      router.push(`/sign-up?redirect_url=${encodeURIComponent(pathname)}`);
      return;
    }
    const body = String(formData.get("body") ?? "").trim();
    if (!body) {
      // docs/BUG_AUDIT_2026-08-18.md S1: this used to `return` silently, so
      // pressing "Post" on an empty (or whitespace-only) box did nothing at
      // all, with no message and no `required` on the input to explain it.
      setSubmitError("Write something first.");
      return;
    }

    setSubmitError(null);
    const parentId = replyTo?.id ?? null;
    startSubmitTransition(async () => {
      const result = await createComment(postId, body, parentId);
      if (result.error || !result.comment) {
        setSubmitError(result.error ?? "Couldn't post your comment.");
        return;
      }
      setComments((prev) => [...prev, result.comment!]);
      setCount((c) => c + 1);
      setReplyTo(null);
      formRef.current?.reset();
    });
  }

  // One level of threading: `parent_comment_id` can technically self-reference
  // arbitrarily deep, but the "Reply" affordance below only ever targets a
  // top-level comment, so this groups into top-level + their direct replies
  // rather than building a recursive tree the UI never produces.
  const topLevel = comments.filter((c) => !c.parentCommentId);
  const repliesByParent = new Map<string, CommentDTO[]>();
  for (const comment of comments) {
    if (!comment.parentCommentId) continue;
    const list = repliesByParent.get(comment.parentCommentId) ?? [];
    list.push(comment);
    repliesByParent.set(comment.parentCommentId, list);
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={expanded}
        className="flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-foreground-subtle transition-colors hover:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <MessageCircle className="h-4 w-4" strokeWidth={1.75} />
        {count > 0 ? `${count} comment${count === 1 ? "" : "s"}` : "Comment"}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col gap-3 overflow-hidden border-t border-hairline-soft pt-3"
          >
            {loadPending && !loaded && <p className="text-xs text-foreground-subtle">Loading comments…</p>}
            {loadError && (
              <p className="text-xs text-critical" role="status" aria-live="polite">
                {loadError}
              </p>
            )}

            {loaded && (
              <div className="flex flex-col gap-3">
                {topLevel.length === 0 ? (
                  <p className="text-xs text-foreground-subtle">No comments yet. Be the first to reply.</p>
                ) : (
                  topLevel.map((comment) => {
                    const replies = repliesByParent.get(comment.id) ?? [];
                    return (
                      <div key={comment.id} className="flex flex-col gap-2">
                        <CommentItem
                          comment={comment}
                          signedIn={signedIn}
                          onReply={() => setReplyTo({ id: comment.id, authorName: comment.authorName })}
                        />
                        {replies.length > 0 && (
                          <div className="ml-4 flex flex-col gap-2 border-l border-hairline-soft pl-3">
                            {replies.map((reply) => (
                              <CommentItem key={reply.id} comment={reply} signedIn={signedIn} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            <form ref={formRef} action={handleSubmit} className="flex flex-col gap-1.5">
              {replyTo && (
                <div className="flex items-center justify-between text-[11px] text-foreground-subtle">
                  <span className="flex items-center gap-1">
                    <CornerDownRight className="h-3 w-3 shrink-0" strokeWidth={2} />
                    Replying to {replyTo.authorName}
                  </span>
                  <button type="button" onClick={() => setReplyTo(null)} className="hover:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
                    Cancel
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  name="body"
                  maxLength={MAX_COMMENT_INPUT_LENGTH}
                  placeholder={
                    signedIn ? (replyTo ? `Reply to ${replyTo.authorName}…` : "Write a comment…") : "Sign up to comment."
                  }
                  className="min-w-0 flex-1 rounded-xl border border-hairline bg-background px-3 py-2 text-xs text-foreground placeholder:text-foreground-subtle focus:border-accent-strong focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={submitPending}
                  aria-busy={submitPending}
                  title={!signedIn ? GUEST_ACTION_TITLE : undefined}
                  className="kivo-gradient-prime flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-on-accent kivo-raise disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  {/* RECOMMENDATIONS item 235 — this button's guest-state
                      label already spelled out "Sign up to comment" before
                      this pass; the glyph just matches the same cue every
                      other gated control in the app now shows. */}
                  <GuestLockHint show={!signedIn} className="h-3 w-3 shrink-0" />
                  {submitPending ? "Posting…" : signedIn ? (replyTo ? "Reply" : "Post") : "Sign up to comment"}
                </button>
              </div>
              {submitError && (
                <p className="text-xs text-critical" role="status" aria-live="polite">
                  {submitError}
                </p>
              )}
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
