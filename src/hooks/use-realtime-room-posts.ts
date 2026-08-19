"use client";

import { useEffect, useRef, useState } from "react";
import { safeSubscribe } from "@/lib/realtime-safe";
import { useSupabaseClient } from "@/lib/supabase/client";
import { resolveAvatarSrc } from "@/lib/kivo-assets";
import type { Database } from "@/lib/supabase/types";
import type { RoomPost } from "@/components/matches/match-room";

type PostsRow = Database["public"]["Tables"]["posts"]["Row"];

/**
 * RECOMMENDATIONS.md item 1 (this task) / item 119's own Realtime precedent:
 * live push for Match Centre's Room tab, via the exact `posts` publication
 * migration 0042_realtime_posts already added for /social's "new posts"
 * pill (src/components/social/social-feed.tsx) — no new publication/RLS
 * work needed, this is a second, differently-behaved consumer of the same
 * real-time feed.
 *
 * WHY THIS AUTO-APPENDS INSTEAD OF COPYING THE FEED'S CLICK-TO-LOAD PILL
 * ------------------------------------------------------------------------
 * /social deliberately does NOT auto-insert a new post — it flips a
 * dismissible "New posts" pill the reader clicks (see social-feed.tsx's own
 * comment) — because a reader can be genuinely mid-article there, and
 * yanking content into place under their eyes without asking is jarring.
 * That reasoning was checked against Match Room specifically, not assumed to
 * transfer, and it doesn't hold here for two real differences:
 *
 *   1. What Room content IS. A Room exists only to watch a specific match
 *      live — short, disposable chat-style commentary, not long-form
 *      reading someone is partway through. There is no "mid-article" state
 *      to protect a Room viewer from; the entire point of opening it during
 *      a live match is to see the next thing that happens as it happens
 *      (doubly true for this task's item 2's own system goal/red-card
 *      posts — a "GOAL" announcement that requires a manual click-to-reveal
 *      is a live match room in name only).
 *   2. Where content lands. Both here and on /social, newest-first ordering
 *      means a new arrival is *prepended*, appearing above whatever the
 *      viewer is currently looking at — never inserted mid-scroll under
 *      their cursor the way a bottom-anchored chat log would. A viewer
 *      scrolled down into older Room history keeps their scroll position;
 *      new content grows the page above the fold, off-screen, until they
 *      scroll back up (and most browsers' native scroll anchoring keeps
 *      whatever DOM node they were reading pinned in the viewport even as
 *      content is added above it). A viewer sitting at the top (the common
 *      case for "watching a live room") sees the new post animate in
 *      immediately, exactly the chat feel this task asked for.
 *
 * Net: this hook merges every real-time INSERT straight into the list, no
 * click required. Kept as its own hook (not folded into MatchRoomTab
 * itself) so the merge/dedupe logic is independently readable, same
 * separation-of-concerns precedent as use-realtime-fixtures.ts.
 *
 * AUTHOR IDENTITY ON A LIVE-STREAMED POST
 * -----------------------------------------
 * A raw `postgres_changes` INSERT payload is just the new row — it carries
 * `author_profile_id`, not the joined display name/avatar fetchPostsPage
 * assembles server-side. For a system post (`is_system`), no join is
 * needed at all: the row itself is the whole story, and the author is
 * always rendered as "KIVO" (see PostCard's own isSystem handling — that
 * rendering never trusts authorName/authorAvatarSrc for a system post
 * regardless of what this hook sets them to). For a real user's post, this
 * resolves the author via `get_public_profiles` — the same public,
 * RLS-safe RPC every other cross-user author lookup in this app already
 * uses (see app/(app)/social/posts.ts) — so a live-streamed post shows a
 * real name/avatar, never a placeholder or a guess. Reaction/comment counts
 * are set to 0 unconditionally: accurate, not fabricated, for a post that
 * (by definition — reactions/comments require an existing post id) cannot
 * yet have either at the instant it was first inserted.
 */
export function useRealtimeRoomPosts(fixtureId: string, initialPosts: RoomPost[]): RoomPost[] {
  const supabase = useSupabaseClient();
  const [posts, setPosts] = useState(initialPosts);

  // Same "adjust state when a prop changes" shape as useRealtimeFixtures: a
  // fresh server-fetched initialPosts array (this viewer's own composer
  // submission completing via createPost's revalidatePath, a plain
  // navigation) always wins over whatever Realtime accumulated locally —
  // self-healing against a duplicate/stale entry a Realtime-only merge
  // could otherwise leave behind, and the reason the dedupe checks below
  // don't need to be perfect to be safe.
  const [prevInitialPosts, setPrevInitialPosts] = useState(initialPosts);
  if (initialPosts !== prevInitialPosts) {
    setPrevInitialPosts(initialPosts);
    setPosts(initialPosts);
  }

  // Read fresh inside the subscription callback without forcing a
  // resubscribe every time `posts` changes — mirrors latestCreatedAtRef in
  // social-feed.tsx. Only used as a fast-path skip (avoid an unnecessary
  // get_public_profiles round trip for a post already known); the
  // functional setPosts updates below are the actual dedupe guarantee, safe
  // even if this ref is momentarily stale under rapid-fire inserts.
  const postsRef = useRef(posts);
  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  useEffect(() => {
    let cancelled = false;

    // Server-side `filter` (not the client-side `ids.has(...)` shape
    // use-realtime-fixtures.ts/social-feed.tsx use) — deliberate, not an
    // inconsistency: those two subscribe to a genuinely unbounded set
    // (every currently-displayed fixture; every post site-wide), where
    // Realtime has no single column to filter on server-side that matches
    // their scope. A Room is inherently one fixture, so `fixture_id=eq.<id>`
    // is the correct, more efficient match for what this hook actually
    // needs — every other open Room's posts never reach this client at all,
    // rather than arriving and being discarded client-side.
    const channel = supabase
      .channel(`room-posts-${fixtureId}`)
      .on<PostsRow>(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posts", filter: `fixture_id=eq.${fixtureId}` },
        (payload) => {
          const inserted = payload.new;
          if (postsRef.current.some((p) => p.id === inserted.id)) return;

          if (inserted.is_system) {
            const systemPost: RoomPost = {
              id: inserted.id,
              body: inserted.body,
              createdAt: inserted.created_at,
              authorName: "KIVO",
              authorAvatarSrc: null,
              reactionCount: 0,
              viewerReaction: null,
              commentCount: 0,
              isSystem: true,
              // A KIVO goal/red-card announcement is never a poll.
              poll: null,
            };
            if (!cancelled) {
              setPosts((prev) => (prev.some((p) => p.id === systemPost.id) ? prev : [systemPost, ...prev]));
            }
            return;
          }

          void Promise.all([
            supabase.rpc("get_public_profiles", { p_ids: [inserted.author_profile_id] }),
            // KN-29: is this a poll? See the doc comment above — an INSERT
            // payload cannot say, so ask.
            supabase
              .from("poll_options")
              .select("id, label, position")
              .eq("post_id", inserted.id)
              .order("position", { ascending: true }),
          ]).then(([{ data: profiles }, { data: options }]) => {
            if (cancelled) return;
            const author = profiles?.[0];
            const newPost: RoomPost = {
              id: inserted.id,
              body: inserted.body,
              createdAt: inserted.created_at,
              authorName: author?.display_name || author?.username || "KIVO fan",
              authorAvatarSrc: author ? resolveAvatarSrc(author) : null,
              reactionCount: 0,
              viewerReaction: null,
              commentCount: 0,
              isSystem: false,
              poll:
                options && options.length > 0
                  ? {
                      // The realtime INSERT payload carries the whole posts
                      // row, poll_kind included — so a templated poll arrives
                      // in the Room already knowing what it is asking.
                      kind: inserted.poll_kind ?? null,
                      options: options.map((option) => ({
                        id: option.id,
                        label: option.label,
                        position: option.position,
                        voteCount: 0,
                      })),
                      totalVotes: 0,
                      viewerOptionId: null,
                      // Not "results failed to load" — this poll is seconds old
                      // and genuinely has no votes. The distinction matters:
                      // `resultsUnavailable` makes PollBlock say so instead of
                      // showing zeros it cannot vouch for.
                      resultsUnavailable: false,
                    }
                  : null,
            };
            setPosts((prev) => (prev.some((p) => p.id === newPost.id) ? prev : [newPost, ...prev]));
          });
        },
      )
      // KN-22. Unfiltered on purpose — see the doc comment for why a
      // fixture_id filter cannot work on a DELETE without leaking the deleted
      // post's body to every subscriber.
      .on<PostsRow>("postgres_changes", { event: "DELETE", schema: "public", table: "posts" }, (payload) => {
        const removedId = (payload.old as Partial<PostsRow>)?.id;
        if (!removedId || cancelled) return;
        setPosts((prev) => (prev.some((p) => p.id === removedId) ? prev.filter((p) => p.id !== removedId) : prev));
      })
      ;

    // Realtime is an enhancement; a socket that cannot open must not take
    // the page down. See src/lib/realtime-safe.ts.
    const teardown = safeSubscribe(channel, "roomPosts", (c) => supabase.removeChannel(c));

    return () => {
      cancelled = true;
      teardown();
    };
  }, [supabase, fixtureId]);

  return posts;
}
