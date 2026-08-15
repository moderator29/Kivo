import { createServerSupabaseClient } from "@/lib/supabase/server";
import { aggregateReactions, type ReactionType } from "@/lib/reactions";

/** `/social` had a flat `.limit(50)` with no way to page further
 * (RECOMMENDATIONS item 119). 20 per page, offset-based "Load more" — same
 * shape as LEAGUES_PAGE_SIZE / TEAMS_PAGE_SIZE (see
 * app/(app)/leagues/constants.ts). */
export const SOCIAL_PAGE_SIZE = 20;

export type PollOption = { id: string; label: string; position: number; voteCount: number };
export type PollSummary = { options: PollOption[]; totalVotes: number; viewerOptionId: string | null };

export type PostListItem = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  authorUsername: string | null;
  reactionCount: number;
  viewerReaction: ReactionType | null;
  commentCount: number;
  /** RECOMMENDATIONS item 172: null for an ordinary post, real per-option
   * vote counts (via get_poll_results) for a poll post — a post "is" a poll
   * purely by having poll_options rows, no post_type column. */
  poll: PollSummary | null;
  /** RECOMMENDATIONS item 173: whether the viewer has this post in `saves`.
   * Always false for a signed-out viewer (saves_select_own has nothing to
   * return them anyway). */
  viewerSaved: boolean;
};

/**
 * Fetches one page of posts starting at `offset`, with reaction totals, the
 * viewer's own reaction, comment counts and author identity joined in — the
 * same multi-query shape both `/social` and Match Centre's Room tab used
 * inline before this was pulled out, so `loadMorePosts` (actions.ts) and a
 * fixture-scoped page can both reuse it instead of re-deriving the joins.
 *
 * Requests PAGE_SIZE + 1 rows via `.range()` so `hasMore` can be read
 * directly off the response, matching loadMoreLeagues / loadMoreTeams.
 */
export async function fetchPostsPage(
  offset: number,
  viewerProfileId: string | null,
  options?: { fixtureId?: string; limit?: number; followingOnly?: boolean; postIds?: string[] },
): Promise<{ error: string | null; posts: PostListItem[]; hasMore: boolean }> {
  const limit = options?.limit ?? SOCIAL_PAGE_SIZE;
  const supabase = createServerSupabaseClient();

  type PostRow = { id: string; body: string; created_at: string; author_profile_id: string };
  let pageRows: PostRow[];
  let hasMore = false;

  if (options?.postIds) {
    // RECOMMENDATIONS item 173: /saved passes an explicit, already-ordered,
    // bounded set of post ids (most-recently-saved first) instead of a feed
    // page — no offset/range pagination, no followingOnly/fixtureId
    // filtering, just hydrate exactly these posts with the same joins every
    // other caller gets.
    if (options.postIds.length === 0) return { error: null, posts: [], hasMore: false };
    const { data, error } = await supabase
      .from("posts")
      .select("id, body, created_at, author_profile_id")
      .in("id", options.postIds);
    if (error) {
      console.error("Failed to load posts", error);
      return { error: "Couldn't load posts. Try again.", posts: [], hasMore: false };
    }
    const rowById = new Map((data ?? []).map((p) => [p.id, p]));
    // .in() doesn't guarantee the result order matches the input array, so
    // the caller's real ordering (by save recency) is restored here.
    pageRows = options.postIds.map((id) => rowById.get(id)).filter((p): p is PostRow => !!p);
  } else {
    // RECOMMENDATIONS item 175: `followed_type = 'user'` (the
    // follow_target_type enum already supports it — see 0001) filtered to
    // posts by the profiles the viewer actually follows. A signed-out viewer
    // can't follow anyone, so this resolves to "nobody" rather than silently
    // falling back to the full feed.
    let followedAuthorIds: string[] | null = null;
    if (options?.followingOnly) {
      if (!viewerProfileId) return { error: null, posts: [], hasMore: false };
      const { data: followRows } = await supabase
        .from("follows")
        .select("followed_id")
        .eq("follower_profile_id", viewerProfileId)
        .eq("followed_type", "user");
      followedAuthorIds = (followRows ?? []).map((f) => f.followed_id);
      // .in("author_profile_id", []) would send a malformed `in.()` filter to
      // PostgREST — short-circuit instead of ever sending that.
      if (followedAuthorIds.length === 0) return { error: null, posts: [], hasMore: false };
    }

    let query = supabase
      .from("posts")
      .select("id, body, created_at, author_profile_id")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit);

    if (options?.fixtureId) query = query.eq("fixture_id", options.fixtureId);
    if (followedAuthorIds) query = query.in("author_profile_id", followedAuthorIds);

    const { data: rows, error } = await query;
    if (error) {
      console.error("Failed to load posts", error);
      return { error: "Couldn't load posts. Try again.", posts: [], hasMore: false };
    }

    const allRows = rows ?? [];
    pageRows = allRows.slice(0, limit);
    hasMore = allRows.length > limit;
  }

  const postIds = pageRows.map((p) => p.id);
  // profiles_select_own_or_admin restricts a plain select to the caller's own
  // row, so a post's author (almost always someone else) can't be read that
  // way — go through the narrow SECURITY DEFINER function instead, same
  // reasoning as the fantasy leaderboard RPC. Real author identity, not a
  // fabricated placeholder.
  const authorIds = [...new Set(pageRows.map((p) => p.author_profile_id))];

  const [{ data: reactions }, { data: authors }, { data: comments }, { data: pollOptionRows }, { data: saveRows }] = await Promise.all([
    postIds.length
      ? supabase
          .from("reactions")
          .select("target_id, profile_id, reaction_type")
          .eq("target_type", "post")
          .in("target_id", postIds)
      : Promise.resolve({ data: [] }),
    authorIds.length ? supabase.rpc("get_public_profiles", { p_ids: authorIds }) : Promise.resolve({ data: [] }),
    // Just the post_id column to keep this a cheap count, not a full thread
    // fetch — full comment bodies are lazy-loaded per post on expand (see
    // comment-actions.ts / comment-thread.tsx).
    postIds.length ? supabase.from("comments").select("post_id").in("post_id", postIds) : Promise.resolve({ data: [] }),
    // poll_options_select_public (0032) makes every post's options readable
    // regardless of whether it's a poll at all — an ordinary post simply has
    // none, so `pollOptionsByPost` below is empty for it.
    postIds.length
      ? supabase.from("poll_options").select("id, post_id, position, label").in("post_id", postIds).order("position", { ascending: true })
      : Promise.resolve({ data: [] }),
    // RECOMMENDATIONS item 173: saves_select_own already scopes this to the
    // viewer's own rows, so an explicit profile_id filter is defence in depth
    // (and lets this skip the query entirely for a signed-out viewer).
    postIds.length && viewerProfileId
      ? supabase.from("saves").select("target_id").eq("profile_id", viewerProfileId).eq("target_type", "post").in("target_id", postIds)
      : Promise.resolve({ data: [] as { target_id: string }[] }),
  ]);

  const authorById = new Map((authors ?? []).map((a) => [a.id, a]));
  const reactionsByPost = aggregateReactions(reactions ?? [], viewerProfileId);

  const commentCountByPost = new Map<string, number>();
  for (const comment of comments ?? []) {
    commentCountByPost.set(comment.post_id, (commentCountByPost.get(comment.post_id) ?? 0) + 1);
  }

  const pollOptionsByPost = new Map<string, { id: string; position: number; label: string }[]>();
  for (const option of pollOptionRows ?? []) {
    const list = pollOptionsByPost.get(option.post_id) ?? [];
    list.push(option);
    pollOptionsByPost.set(option.post_id, list);
  }
  const pollPostIds = [...pollOptionsByPost.keys()];

  // Real vote counts via get_poll_results — poll_votes_select_own means a
  // plain client query can never see another user's individual pick, same
  // reasoning as predictions/get_prediction_consensus above it. One RPC call
  // per poll on this page rather than a single batched call (unlike
  // get_prediction_consensus's array parameter): feed pages mix poll and
  // non-poll posts, and polls are expected to be a small minority of any
  // given page, so N is small in practice — a batched
  // get_poll_results(post_ids[]) would be the natural follow-up if that
  // assumption stops holding.
  const [pollResultsEntries, viewerVoteRows] = await Promise.all([
    Promise.all(
      pollPostIds.map(async (postId) => {
        const { data } = await supabase.rpc("get_poll_results", { p_post_id: postId });
        return [postId, data ?? []] as const;
      }),
    ),
    pollPostIds.length && viewerProfileId
      ? supabase.from("poll_votes").select("post_id, option_id").eq("profile_id", viewerProfileId).in("post_id", pollPostIds)
      : Promise.resolve({ data: [] as { post_id: string; option_id: string }[] }),
  ]);
  const pollResultsByPost = new Map(pollResultsEntries);
  const viewerVoteByPost = new Map((viewerVoteRows.data ?? []).map((v) => [v.post_id, v.option_id]));
  const savedPostIds = new Set((saveRows ?? []).map((s) => s.target_id));

  return {
    error: null,
    hasMore,
    posts: pageRows.map((post) => {
      const reactionSummary = reactionsByPost.get(post.id) ?? { count: 0, viewerReaction: null };
      const author = authorById.get(post.author_profile_id);
      const options = pollOptionsByPost.get(post.id);
      const results = pollResultsByPost.get(post.id) ?? [];
      const voteCountByOption = new Map(results.map((r) => [r.option_id, r.vote_count]));
      const poll: PollSummary | null = options
        ? {
            options: options.map((option) => ({
              id: option.id,
              label: option.label,
              position: option.position,
              voteCount: voteCountByOption.get(option.id) ?? 0,
            })),
            totalVotes: results.reduce((sum, r) => sum + r.vote_count, 0),
            viewerOptionId: viewerVoteByPost.get(post.id) ?? null,
          }
        : null;
      return {
        id: post.id,
        body: post.body,
        createdAt: post.created_at,
        authorName: author?.display_name || author?.username || "KIVO fan",
        authorUsername: author?.username ?? null,
        reactionCount: reactionSummary.count,
        viewerReaction: reactionSummary.viewerReaction,
        commentCount: commentCountByPost.get(post.id) ?? 0,
        poll,
        viewerSaved: savedPostIds.has(post.id),
      };
    }),
  };
}
