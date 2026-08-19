import Link from "next/link";
import { ArrowRight, Flame, Info, MessageSquare, Star, Users } from "lucide-react";
import { LocalDateTime } from "@/components/ui/relative-time";
import {
  MIN_TRENDING_PARTICIPANTS,
  TRENDING_WINDOW_HOURS,
  sentimentReading,
  type FanSentiment,
} from "@/lib/trending";
import type { TrendingResult, TrendingRoom } from "@/app/(app)/social/trending";

/**
 * "Trending" on KIVO, and the four things it can say.
 *
 * Every state is a real one and each says something different, because the
 * failure mode this panel exists to avoid is a ranking that looks identical
 * whether it is built on four hundred people or on one:
 *
 *   unavailable  the query failed. Not the same as a quiet window, and it says
 *                so, for the same reason PollBlock refuses to render 0%% from a
 *                failed results call.
 *   empty        nothing happened in the window. An honest quiet night.
 *   too quiet    something happened and it is not a trend. The real totals are
 *                printed anyway, because "9 posts from 2 people" is both more
 *                honest and more useful than a blank panel.
 *   ranked       real counts, from real people, in a stated window.
 *
 * The window is on screen, always. A "trending" number with no period attached
 * is not a claim about anything, and this is the panel where that shortcut
 * would be easiest to take.
 */
export function TrendingPanel({ result }: { result: TrendingResult }) {
  const { verdict, unavailable } = result;

  return (
    <section className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Flame className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
          Match rooms people are in
        </h2>
        <span className="shrink-0 text-[11px] text-foreground-subtle">last {TRENDING_WINDOW_HOURS}h</span>
      </div>

      {unavailable ? (
        <p className="text-xs text-warning">Couldn&apos;t work out what&apos;s busy right now. Try again shortly.</p>
      ) : verdict.kind === "empty" ? (
        <p className="text-xs leading-relaxed text-foreground-subtle">
          Nobody has posted in a match room in the last {TRENDING_WINDOW_HOURS} hours. This fills up on its own once
          people start talking during a match.
        </p>
      ) : verdict.kind === "too-quiet" ? (
        <p className="text-xs leading-relaxed text-foreground-subtle">
          {verdict.items} match room{verdict.items === 1 ? " has" : "s have"} had activity in the last{" "}
          {TRENDING_WINDOW_HOURS} hours, but from {verdict.participants}{" "}
          {verdict.participants === 1 ? "person" : "people"} at most — too few to call anything trending. KIVO would
          rather say that than rank it.
        </p>
      ) : (
        <ul className="flex flex-col">
          {verdict.rows.map((room, index) => (
            <TrendingRoomRow key={room.fixtureId} room={room} first={index === 0} />
          ))}
        </ul>
      )}

      {verdict.kind === "ranked" && (
        <p className="flex items-start gap-1.5 border-t border-hairline-soft pt-3 text-[10px] leading-relaxed text-foreground-subtle">
          <Info className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2} />
          Ordered by how many different people posted or replied, then by how much was said. Real counts only —
          nothing here is weighted or scored, and a room needs at least {MIN_TRENDING_PARTICIPANTS} people to appear.
        </p>
      )}
    </section>
  );
}

function TrendingRoomRow({ room, first }: { room: TrendingRoom; first: boolean }) {
  return (
    <li className={first ? "" : "border-t border-hairline-soft"}>
      <Link
        href={`/matches/${room.fixtureId}?tab=room`}
        className="kivo-focus flex items-center gap-3 rounded-xl px-1 py-3 transition-colors hover:bg-surface-2"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-sm font-medium text-foreground">
            {room.homeTeamName} v {room.awayTeamName}
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-foreground-subtle">
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3 shrink-0" strokeWidth={2} />
              {room.participantCount} {room.participantCount === 1 ? "person" : "people"}
            </span>
            <span className="flex items-center gap-1">
              <MessageSquare className="h-3 w-3 shrink-0" strokeWidth={2} />
              {room.postCount + room.commentCount}
            </span>
            <LocalDateTime iso={room.kickoffAt} format="weekdayTime" />
          </span>
          <SentimentLine sentiment={room.sentiment} />
        </div>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-foreground-subtle" strokeWidth={2} />
      </Link>
    </li>
  );
}

/**
 * Fan sentiment for one match, from two real sources and nothing else: the
 * `fan_ratings` a person actually submitted, and the votes actually cast on
 * that room's polls.
 *
 * Renders a number and a count, never a word. "Positive" and "mixed" are
 * boundaries somebody picked, and printing one would hide that choice behind
 * a label; 3.8 out of 5 from 41 fans is a fact the reader interprets
 * themselves. Below a real sample it says how few there are rather than
 * showing an average that one person decided.
 */
function SentimentLine({ sentiment }: { sentiment: FanSentiment }) {
  const reading = sentimentReading(sentiment);
  const polls =
    sentiment.pollCount > 0
      ? `${sentiment.pollVoteCount} poll vote${sentiment.pollVoteCount === 1 ? "" : "s"}`
      : null;

  if (reading.kind === "none" && !polls) return null;

  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-foreground-muted">
      {reading.kind === "real" && (
        <span className="flex items-center gap-1">
          <Star className="h-3 w-3 shrink-0 text-achievement" strokeWidth={2} />
          {reading.avgRating.toFixed(1)}/5 from {reading.ratingCount} fans
        </span>
      )}
      {reading.kind === "too-few" && (
        <span className="text-foreground-subtle">
          {reading.ratingCount} fan rating{reading.ratingCount === 1 ? "" : "s"} — too few to average
        </span>
      )}
      {polls && <span className="text-foreground-subtle">{polls}</span>}
    </span>
  );
}
