"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, Eye, Lock, PencilLine } from "lucide-react";
import { RoomComposer } from "@/components/matches/room-composer";
import { RoomMessage } from "@/components/social/room-message";
import { useRealtimeRoomPosts } from "@/hooks/use-realtime-room-posts";
import { useRoomPresence } from "@/hooks/use-room-presence";
import { useMatchRoomWindow } from "@/hooks/use-match-room-window";
import { LocalDateTime } from "@/components/ui/relative-time";
import type { MatchRoomWindow } from "@/lib/match-room-window";
import type { FixtureStatus } from "@/lib/football/fixture-status";
import type { PollSummary } from "@/app/(app)/social/posts";
import type { ReactionType } from "@/lib/reactions";

export type RoomPost = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  authorAvatarSrc: string | null;
  reactionCount: number;
  viewerReaction: ReactionType | null;
  commentCount: number;
  /** RECOMMENDATIONS item 254: true only for a KIVO-authored automatic
   * goal/red-card announcement — see PostCard's isSystem prop. */
  isSystem: boolean;
  /** KN-29: null for an ordinary Room post, real options and vote counts for a
   * poll. The founding brief names polls by example as "score/MOTM/ref
   * decisions" — all three are inherently about one match, so a Room that
   * cannot show a poll cannot show the one poll type the brief specifies. */
  poll: PollSummary | null;
};

/**
 * Fixture-scoped feed for Match Centre's "Room" tab. Same PostCard /
 * CommentThread / reactions infrastructure as the general `/social` feed
 * (see src/app/(app)/social/page.tsx), just filtered to `posts.fixture_id`.
 * `initialPosts` is fetched server-side in matches/[id]/page.tsx and handed
 * down as plain, already-serialized data for the first paint; from then on
 * useRealtimeRoomPosts (RECOMMENDATIONS item 1) merges in every new post —
 * a fan's own, or a system goal/red-card announcement (item 2) — the
 * instant it's inserted, for every viewer currently on this tab, no
 * manual refresh or click required. See that hook's own doc comment for why
 * Room auto-appends instead of reusing /social's click-to-reveal pill.
 */
export function MatchRoomTab({
  fixtureId,
  signedIn,
  viewer = null,
  posts: initialPosts,
  scrollToPostId = null,
  homeTeamName,
  awayTeamName,
  isFinished = false,
  kickoffAt,
  status,
  serverWindow,
}: {
  fixtureId: string;
  signedIn: boolean;
  /** KN-100: the two real club names, so the "Who wins?" template can offer
   * them as poll options rather than the composer inventing labels. */
  homeTeamName: string;
  awayTeamName: string;
  /** KN-100: after full time "who wins?" is answered, so that template is not
   * offered — and "man of the match" becomes the one that makes sense. */
  isFinished?: boolean;
  /** The two facts the open/closed window is derived from. Passed rather than
   * re-fetched — the fixture page has both for its own header. */
  kickoffAt: string;
  status: FixtureStatus;
  /** The window as the server saw it when it rendered this page. Used verbatim
   * for the hydration render and then kept live off the browser's clock; see
   * use-match-room-window.ts for why both halves are needed. */
  serverWindow: MatchRoomWindow;
  /** KN-62: who is watching, for Realtime Presence. Keyed by profile id so two
   * tabs of one person count once; the name is only ever used for the typing
   * line, never for the watching count. */
  viewer?: { id: string; name: string } | null;
  posts: RoomPost[];
  /** RECOMMENDATIONS item 237: a post id to scroll to and briefly highlight
   * on mount — MatchCentrePage has already guaranteed this id is present in
   * `posts` before this component ever renders. */
  scrollToPostId?: string | null;
}) {
  const posts = useRealtimeRoomPosts(fixtureId, initialPosts);
  const roomWindow = useMatchRoomWindow(kickoffAt, status, serverWindow);

  const [typing, setTyping] = useState(false);
  const { watching, typingNames } = useRoomPresence(fixtureId, viewer, typing);

  // KN-62: which posts were already here when this viewer arrived. Captured
  // once, from the server-rendered first page — everything above the divider
  // below arrived while they were watching. Deliberately not persisted: this
  // answers "what have I missed since I opened this", which is the question a
  // live Room actually raises, and answering "since your last visit" honestly
  // would need a per-user read marker the schema does not have.
  // `useState` with a lazy initialiser rather than a ref: the set is read
  // during render to compute the divider position, and a ref read during
  // render is exactly what React's rules forbid. The initialiser runs once,
  // so this is still "the posts that were here when I arrived", frozen.
  const [arrivedWith] = useState(() => new Set(initialPosts.map((post) => post.id)));
  const newSinceArrival = useMemo(
    () => posts.filter((post) => !arrivedWith.has(post.id)).length,
    [posts, arrivedWith],
  );

  // Same one-shot scroll + fade-highlight as SocialFeed's own
  // scrollToPostId handling (src/components/social/social-feed.tsx) — kept
  // as a separate small effect here rather than factored into a shared hook,
  // since the two host different DOM shapes (posts vs. Room posts) and each
  // is only a few lines.
  const [highlightPostId, setHighlightPostId] = useState(scrollToPostId);
  useEffect(() => {
    if (!scrollToPostId) return;
    const el = document.getElementById(`post-${scrollToPostId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    const timeout = setTimeout(() => setHighlightPostId(null), 1600);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <RoomPresenceBar watching={watching} typingNames={typingNames} />

      {roomWindow.phase === "pre-match" && <RoomPreMatchNote kickoffAt={kickoffAt} />}

      {/* Sticky, because a live room is read with one thumb: the box you type
          into has to still be reachable after you have scrolled, and with a
          newest-first list the composer sitting above it means a new message
          lands exactly where you are already looking. */}
      {roomWindow.open ? (
        <div className="sticky top-16 z-20 -mx-1 bg-background/85 px-1 py-1 backdrop-blur-xl">
        <RoomComposer
          signedIn={signedIn}
          fixtureId={fixtureId}
          onTypingChange={setTyping}
          homeTeamName={homeTeamName}
          awayTeamName={awayTeamName}
          isFinished={isFinished}
        />
        </div>
      ) : (
        <RoomClosedNote closedAt={roomWindow.closedAt} />
      )}

      {/* Chat density, not feed density. `RoomMessage` is the same content as
          a PostCard with the card taken off — see its own comment for the
          measurement, and for why KIVO's own goal and red-card posts are drawn
          as match events rather than as messages. */}
      {posts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-hairline px-6 py-10 text-center">
          <p className="text-sm text-foreground-muted">Nobody&apos;s said anything yet.</p>
          <p className="max-w-xs text-xs text-foreground-subtle">
            Rooms open the moment a fixture lands and stay open a day after full time. First word is yours.
          </p>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-hairline-soft">
          {posts.map((post, index) => (
            <div key={post.id} className="flex flex-col gap-3 py-0.5">
            <RoomMessage
              id={post.id}
              body={post.body}
              createdAt={post.createdAt}
              authorName={post.authorName}
              authorAvatarSrc={post.authorAvatarSrc}
              reactionCount={post.reactionCount}
              viewerReaction={post.viewerReaction}
              commentCount={post.commentCount}
              signedIn={signedIn}
              index={index}
              highlighted={post.id === highlightPostId}
              isSystem={post.isSystem}
              poll={post.poll}
            />
            {/* The line between what arrived while you were here and what was
                already on screen when you opened the Room. Rendered after the
                last new post because the Room is newest-first, and only while
                there is older content below it to separate from. */}
            {index === newSinceArrival - 1 && index < posts.length - 1 && (
              <div className="flex items-center gap-3 px-1" role="separator" aria-label="New since you opened this Room">
                <span className="h-px flex-1 bg-accent/40" />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-accent">
                  {newSinceArrival === 1 ? "1 new since you opened this" : `${newSinceArrival} new since you opened this`}
                </span>
                <span className="h-px flex-1 bg-accent/40" />
              </div>
            )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * KN-62: presence, and nothing that isn't presence.
 *
 * `watching` is a count of really-connected clients from Supabase Realtime
 * Presence (see use-room-presence.ts), keyed by profile id so one person with
 * two tabs counts once. It renders only once the channel has actually synced
 * somebody, so a Room nobody is in shows nothing at all rather than "1
 * watching" inferred from the fact that you are standing in it. No floor, no
 * rounding, and explicitly never an invented "12 people are here".
 *
 * Names appear only against *typing*. Reading a Room is not a public act;
 * typing into one is a second away from posting publicly under that name.
 *
 * Split out as its own presentational component so the wording and layout can
 * be rendered and checked against real props without a live websocket — which
 * is also why it takes numbers rather than calling the hook itself.
 */
export function RoomPresenceBar({ watching, typingNames }: { watching: number; typingNames: string[] }) {
  if (watching === 0 && typingNames.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-foreground-subtle">
      {watching > 0 && (
        <span className="flex items-center gap-1.5" aria-live="polite">
          <Eye className="h-3 w-3 shrink-0" strokeWidth={2} />
          {watching === 1 ? "You're the only one here right now" : `${watching} watching right now`}
        </span>
      )}
      {typingNames.length > 0 && (
        <span className="flex items-center gap-1.5 text-accent" aria-live="polite">
          <PencilLine className="h-3 w-3 shrink-0 animate-pulse" strokeWidth={2} />
          {typingNames.length === 1
            ? `${typingNames[0]} is typing…`
            : typingNames.length === 2
              ? `${typingNames[0]} and ${typingNames[1]} are typing…`
              : `${typingNames.length} people are typing…`}
        </span>
      )}
    </div>
  );
}

/**
 * Before kickoff the Room is open — that is the founder's rule and it is the
 * right one, since arguing about a match beforehand is most of what a match
 * room is for. But an open composer with no other signal reads as "this match
 * is under way", so this line says which kind of open it is.
 *
 * It is a note, not a lock. Nothing about it prevents posting.
 */
function RoomPreMatchNote({ kickoffAt }: { kickoffAt: string }) {
  return (
    <div className="kivo-glass flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs text-foreground-subtle">
      <Clock className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
      <span>
        Not started yet — kick-off <LocalDateTime iso={kickoffAt} format="deadline" />. The room&apos;s open now, get
        your take in early.
      </span>
    </div>
  );
}

/**
 * A day after full time the Room stops taking new posts and becomes what it
 * already was: the record of what people said about that match.
 *
 * Everything above this stays on screen — the posts, the reactions, the polls
 * and their results. Closing a room here means "no new posts", never "this
 * conversation is gone", which is why this replaces only the composer.
 *
 * The server action refuses a late post as well, and so does a RESTRICTIVE RLS
 * policy (migration 0110) — this notice is the courtesy, not the enforcement.
 */
function RoomClosedNote({ closedAt }: { closedAt: string }) {
  return (
    <div className="kivo-glass flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs text-foreground-subtle">
      <Lock className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      <span>
        This room closed to new posts on <LocalDateTime iso={closedAt} format="deadline" />, a day after full time.
        Everything said here stays.
      </span>
    </div>
  );
}
