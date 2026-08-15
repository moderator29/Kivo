import { createServerSupabaseClient } from "@/lib/supabase/server";
import { aggregateReactions, type ReactionType } from "@/lib/reactions";

/** `/social` had a flat `.limit(50)` with no way to page further
 * (RECOMMENDATIONS item 119). 20 per page, offset-based "Load more" — same
 * shape as LEAGUES_PAGE_SIZE / TEAMS_PAGE_SIZE (see
 * app/(app)/leagues/constants.ts). */
export const SOCIAL_PAGE_SIZE = 20;

export type PostListItem = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  authorUsername: string | null;
  reactionCount: number;
  viewerReaction: ReactionType | null;
  commentCount: number;
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
  options?: { fixtureId?: string; limit?: number },
): Promise<{ error: string | null; posts: PostListItem[]; hasMore: boolean }> {
  const limit = options?.limit ?? SOCIAL_PAGE_SIZE;
  const supabase = createServerSupabaseClient();

  let query = supabase
    .from("posts")
    .select("id, body, created_at, author_profile_id")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit);

  if (options?.fixtureId) query = query.eq("fixture_id", options.fixtureId);

  const { data: rows, error } = await query;
  if (error) {
    console.error("Failed to load posts", error);
    return { error: "Couldn't load posts. Try again.", posts: [], hasMore: false };
  }

  const allRows = rows ?? [];
  const pageRows = allRows.slice(0, limit);
  const hasMore = allRows.length > limit;

  const postIds = pageRows.map((p) => p.id);
  // profiles_select_own_or_admin restricts a plain select to the caller's own
  // row, so a post's author (almost always someone else) can't be read that
  // way — go through the narrow SECURITY DEFINER function instead, same
  // reasoning as the fantasy leaderboard RPC. Real author identity, not a
  // fabricated placeholder.
  const authorIds = [...new Set(pageRows.map((p) => p.author_profile_id))];

  const [{ data: reactions }, { data: authors }, { data: comments }] = await Promise.all([
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
  ]);

  const authorById = new Map((authors ?? []).map((a) => [a.id, a]));
  const reactionsByPost = aggregateReactions(reactions ?? [], viewerProfileId);

  const commentCountByPost = new Map<string, number>();
  for (const comment of comments ?? []) {
    commentCountByPost.set(comment.post_id, (commentCountByPost.get(comment.post_id) ?? 0) + 1);
  }

  return {
    error: null,
    hasMore,
    posts: pageRows.map((post) => {
      const reactionSummary = reactionsByPost.get(post.id) ?? { count: 0, viewerReaction: null };
      const author = authorById.get(post.author_profile_id);
      return {
        id: post.id,
        body: post.body,
        createdAt: post.created_at,
        authorName: author?.display_name || author?.username || "KIVO fan",
        authorUsername: author?.username ?? null,
        reactionCount: reactionSummary.count,
        viewerReaction: reactionSummary.viewerReaction,
        commentCount: commentCountByPost.get(post.id) ?? 0,
      };
    }),
  };
}
