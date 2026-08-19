"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Check } from "lucide-react";
import { voteOnPoll } from "@/app/(app)/social/actions";
import { GUEST_ACTION_TITLE, GuestLockHint } from "@/components/ui/guest-lock-hint";
import { RetryableError } from "@/components/ui/retryable-error";
import type { PollOption, PollSummary } from "@/app/(app)/social/posts";
import { POLL_KIND_LABEL } from "@/lib/match-room-polls";
import { cn } from "@/lib/utils";

/**
 * Lifted out of PostCard unchanged so a Match Room message can render the same
 * ballot the feed does. A poll is the one thing in a Room that is emphatically
 * not chat — it is a question the room is answering — so it keeps its full
 * shape at every density.
 */
/**
 * RECOMMENDATIONS.md item 172: real, live vote counts (get_poll_results via
 * fetchPostsPage) with the viewer's own pick highlighted. Bars are always
 * visible — voting isn't gated behind seeing results first — and tapping
 * any option (including the viewer's current one, to change it) calls
 * voteOnPoll, which is delete-then-insert server-side. Optimistic update
 * with rollback on error, same shape as PredictionCard's handlePick.
 */
/** How many options a poll shows before it asks to be expanded. Six fits a
 * 390px Room post without dominating it, and is comfortably more than the
 * 2-4 a freeform poll can ever have — so this only ever affects a templated
 * ballot. */
const VISIBLE_POLL_OPTIONS = 6;

/**
 * The top options by real vote count, plus the viewer's own pick if it did not
 * make that cut.
 *
 * The second half matters more than the first. A voter whose choice is
 * twelfth on a twenty-two-name ballot would otherwise open the poll and see
 * no trace of the vote they cast, which reads as the vote having been lost.
 */
function collapsePollOptions(poll: PollSummary): PollOption[] {
  const byVotes = [...poll.options].sort((a, b) => b.voteCount - a.voteCount);
  const top = byVotes.slice(0, VISIBLE_POLL_OPTIONS);
  if (!poll.viewerOptionId || top.some((option) => option.id === poll.viewerOptionId)) return top;
  const own = poll.options.find((option) => option.id === poll.viewerOptionId);
  return own ? [...top.slice(0, VISIBLE_POLL_OPTIONS - 1), own] : top;
}

export function PollBlock({ postId, poll, signedIn }: { postId: string; poll: PollSummary; signedIn: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [localPoll, setLocalPoll] = useState(poll);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // KN-56: remembering which option failed is what makes "Try again" possible
  // at all — the rollback puts the poll back the way it was, so without this
  // there is nothing left on screen saying what the user had picked.
  const [failedOptionId, setFailedOptionId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  function handleVote(optionId: string) {
    if (!signedIn) {
      router.push(`/sign-up?redirect_url=${encodeURIComponent(pathname)}`);
      return;
    }
    if (pending || optionId === localPoll.viewerOptionId) return;
    setError(null);
    setFailedOptionId(null);
    const previous = localPoll;
    const previousOptionId = localPoll.viewerOptionId;
    setLocalPoll((current) => ({
      ...current,
      resultsUnavailable: current.resultsUnavailable,
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
        setFailedOptionId(optionId);
      }
    });
  }

  const total = localPoll.totalVotes;

  // A man-of-the-match ballot seeded from two real starting XIs is twenty-two
  // options. Showing all of them by default turns a Room post into a page, so
  // the list opens at the top few and expands — sorted by real votes so the
  // collapsed view is the room's actual answer rather than shirt-number order.
  // Nothing is hidden permanently, and the count below always reflects every
  // option, not the visible slice.
  const longList = localPoll.options.length > VISIBLE_POLL_OPTIONS;
  const ordered = longList && !expanded ? collapsePollOptions(localPoll) : localPoll.options;

  return (
    <div className="flex flex-col gap-2">
      {localPoll.kind && (
        <span className="flex w-fit items-center gap-1 rounded-lg border border-hairline px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-subtle">
          {POLL_KIND_LABEL[localPoll.kind]}
        </span>
      )}
      {ordered.map((option) => {
        // A failed get_poll_results leaves every count at 0. Rendering "0%"
        // from that would be inventing a number, so the bar stays empty and
        // the percentage is simply not shown (see PollSummary.resultsUnavailable).
        const pct = !localPoll.resultsUnavailable && total > 0 ? Math.round((option.voteCount / total) * 100) : 0;
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
                {isOwn && <Check className="h-3 w-3 shrink-0" strokeWidth={2} />}
                <span className="truncate">{option.label}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-foreground-subtle">
                {/* RECOMMENDATIONS item 235 */}
                <GuestLockHint show={!signedIn} className="h-2.5 w-2.5 shrink-0" />
                {localPoll.resultsUnavailable ? "" : `${pct}%`}
              </span>
            </span>
          </button>
        );
      })}
      {longList && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="kivo-focus w-fit rounded-lg px-1 py-0.5 text-[11px] font-medium text-accent transition-colors hover:text-foreground"
        >
          {expanded
            ? "Show fewer"
            : `Show all ${localPoll.options.length} option${localPoll.options.length === 1 ? "" : "s"}`}
        </button>
      )}
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-foreground-subtle">
          {localPoll.resultsUnavailable ? "Couldn't load results" : `${total} vote${total === 1 ? "" : "s"}`}
        </p>
        {error && (
          <RetryableError
            size="xs"
            message={error}
            retrying={pending}
            onRetry={failedOptionId ? () => handleVote(failedOptionId) : undefined}
          />
        )}
      </div>
    </div>
  );
}
