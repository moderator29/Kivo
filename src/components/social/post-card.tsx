"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Flag, Check } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { reportContent } from "@/app/(app)/social/report-actions";
import { CommentThread } from "@/components/social/comment-thread";
import { ReactionPicker } from "@/components/social/reaction-picker";
import type { ReactionType } from "@/lib/reactions";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/format";

const REPORT_REASONS = ["Spam", "Harassment or abuse", "Misinformation", "Inappropriate content", "Other"] as const;

interface PostCardProps {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  /** Optional so existing call sites that haven't wired author identity through
   * yet still type-check; the name simply doesn't link without it. */
  authorUsername?: string | null;
  reactionCount: number;
  viewerReaction: ReactionType | null;
  commentCount: number;
  signedIn: boolean;
  index?: number;
}

export function PostCard({
  id,
  body,
  createdAt,
  authorName,
  authorUsername = null,
  reactionCount,
  viewerReaction,
  commentCount,
  signedIn,
  index = 0,
}: PostCardProps) {
  const router = useRouter();
  const pathname = usePathname();

  const [reportMenuOpen, setReportMenuOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const [justReported, setJustReported] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportPending, startReportTransition] = useTransition();
  const reportMenuRef = useRef<HTMLDivElement>(null);

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
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
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
      // lib/notification-registry.ts, `/social#post-<id>`). scroll-mt clears
      // the sticky TopBar (and, on Match Centre, the sticky score card) so
      // the post the link lands on isn't hidden underneath it.
      id={`post-${id}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index, 6) * 0.04, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2, transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] } }}
      className="kivo-glass scroll-mt-24 flex flex-col gap-3 rounded-2xl p-4 transition-shadow duration-300 hover:shadow-[0_12px_40px_-16px_rgba(37,99,255,0.35)]"
    >
      <div className="flex items-center gap-2">
        <div className="kivo-gradient-prime flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-kivo-white">
          {authorName.charAt(0).toUpperCase()}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {authorUsername ? (
            <Link
              href={`/u/${authorUsername}`}
              className="w-fit truncate text-sm font-medium text-foreground hover:text-kivo-cyan"
            >
              {authorName}
            </Link>
          ) : (
            <span className="truncate text-sm font-medium text-foreground">{authorName}</span>
          )}
          <span className="text-xs text-foreground-subtle">{timeAgo(createdAt)}</span>
        </div>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{body}</p>
      <div className="flex items-center justify-between gap-2">
        <ReactionPicker targetType="post" targetId={id} count={reactionCount} viewerReaction={viewerReaction} signedIn={signedIn} />

        <div ref={reportMenuRef} className="relative">
          <motion.button
            type="button"
            onClick={handleReportClick}
            disabled={reported || reportPending}
            aria-haspopup={signedIn ? "menu" : undefined}
            aria-expanded={reportMenuOpen}
            aria-label={reported ? "Reported" : "Report post"}
            whileTap={reported ? undefined : { scale: 0.88 }}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60 disabled:cursor-not-allowed",
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
                className="kivo-glass-sharp absolute right-0 bottom-full z-20 mb-2 w-48 overflow-hidden rounded-xl p-1"
              >
                <p className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-subtle">
                  Report this post
                </p>
                {REPORT_REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    role="menuitem"
                    disabled={reportPending}
                    onClick={() => submitReport(reason)}
                    className="block w-full rounded-lg px-2.5 py-1.5 text-left text-xs text-foreground-muted transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-50"
                  >
                    {reason}
                  </button>
                ))}
                {reportError && <p className="px-2.5 py-1.5 text-[11px] text-critical">{reportError}</p>}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <CommentThread postId={id} initialCount={commentCount} signedIn={signedIn} />
    </motion.article>
  );
}
