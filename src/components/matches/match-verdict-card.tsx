"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";
import { reactionEmoji, type ReactionType } from "@/lib/reactions";

// Same real-sample threshold as FanRatingCard/HeadToHeadCard/PredictionCard —
// a verdict built off one fan rating would be exactly the "100% off one
// vote" problem item 170 (and by extension 171) explicitly rules out.
const MIN_MEANINGFUL_SAMPLE = 3;

type MatchVerdictCardProps = {
  homeTeamName: string;
  awayTeamName: string;
  scoreLabel: string;
  fanRatingCount: number;
  fanRatingAvg: number | null;
  /** Sum of real reaction counts across this fixture's Room posts — already
   * computed by fetchPostsPage for MatchCentreTabs' Room tab, not a new
   * query. */
  roomReactionCount: number;
  roomPostCount: number;
  /**
   * KIVO_NEXT_GEN KN-101. Two more real counts: the minute of the match with
   * the most Room posts, and the Room's most-used reaction. Both null unless
   * they clear a real floor — see getRoomVerdictExtras in
   * src/lib/football/room-verdict.ts for the thresholds and why they exist.
   *
   * The item also suggests a "top-rated moment". Deliberately absent:
   * `fan_ratings` rates the fixture, not a moment (migration 0032), so a
   * top-rated moment would have to be inferred from post volume and then
   * presented as a rating — the sentiment-shaped fabrication the item's own
   * last line rules out.
   */
  busiestMinute?: { minute: number; postCount: number } | null;
  topReaction?: { type: ReactionType; count: number } | null;
};

/**
 * RECOMMENDATIONS item 171: item 170's fan rating aggregate plus real
 * match-room reaction counts, rendered as a shareable summary. "Shareable"
 * means a real clipboard copy of the real numbers below — not a fabricated
 * share-network integration, and nothing here is invented: it renders
 * nothing at all once neither number clears a real, honest floor (a rating
 * average below MIN_MEANINGFUL_SAMPLE, or zero Room reactions).
 */
export function MatchVerdictCard({
  homeTeamName,
  awayTeamName,
  scoreLabel,
  fanRatingCount,
  fanRatingAvg,
  roomReactionCount,
  roomPostCount,
  busiestMinute = null,
  topReaction = null,
}: MatchVerdictCardProps) {
  const [copied, setCopied] = useState(false);
  const hasRealRatingAvg = fanRatingCount >= MIN_MEANINGFUL_SAMPLE && fanRatingAvg !== null;
  const hasRoomActivity = roomReactionCount > 0;

  if (!hasRealRatingAvg && !hasRoomActivity) return null;

  function handleCopy() {
    const lines = [
      `${homeTeamName} ${scoreLabel} ${awayTeamName}: the KIVO verdict`,
      hasRealRatingAvg ? `${fanRatingAvg!.toFixed(1)}/5 from ${fanRatingCount} fan ratings` : null,
      hasRoomActivity
        ? `${roomReactionCount} reaction${roomReactionCount === 1 ? "" : "s"} across ${roomPostCount} post${roomPostCount === 1 ? "" : "s"} in the Room`
        : null,
      busiestMinute
        ? `Busiest minute: ${busiestMinute.minute}' (${busiestMinute.postCount} posts)`
        : null,
      topReaction ? `Most-used reaction: ${reactionEmoji(topReaction.type)} (${topReaction.count})` : null,
    ].filter((line): line is string => line !== null);

    navigator.clipboard.writeText(lines.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }

  return (
    <div className="kivo-glass-brand flex flex-col gap-3 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Match verdict</h2>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-foreground-subtle transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {copied ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : <Share2 className="h-3.5 w-3.5" strokeWidth={2} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <div className="flex items-center gap-6">
        {hasRealRatingAvg && (
          <div className="flex flex-col gap-0.5">
            <span className="text-3xl font-bold text-foreground">{fanRatingAvg!.toFixed(1)}</span>
            <span className="text-[11px] text-foreground-subtle">/5 · {fanRatingCount} fan ratings</span>
          </div>
        )}
        {hasRoomActivity && (
          <div className="flex flex-col gap-0.5">
            <span className="text-3xl font-bold text-foreground">{roomReactionCount}</span>
            <span className="text-[11px] text-foreground-subtle">
              reaction{roomReactionCount === 1 ? "" : "s"} in the Room
            </span>
          </div>
        )}
      </div>

      {/* KN-101: two more real counts, each rendered only when it cleared its
          own floor. A room with three posts has a "busiest minute" in the
          arithmetic sense and it means nothing, so getRoomVerdictExtras
          returns null and nothing appears here. */}
      {(busiestMinute || topReaction) && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-hairline-soft pt-3">
          {busiestMinute && (
            <span className="text-[11px] text-foreground-subtle">
              Busiest minute{" "}
              <span className="font-semibold text-foreground">{busiestMinute.minute}&apos;</span> ·{" "}
              {busiestMinute.postCount} posts
            </span>
          )}
          {topReaction && (
            <span className="text-[11px] text-foreground-subtle">
              Most-used reaction{" "}
              <span className="text-sm" aria-hidden="true">
                {reactionEmoji(topReaction.type)}
              </span>{" "}
              <span className="font-semibold text-foreground">{topReaction.count}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
