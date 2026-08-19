import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/params";
import type { FixtureStatus } from "@/lib/football/fixture-status";
import { aggregateReactions, type ReactionType } from "@/lib/reactions";
import { resolveAvatarSrc } from "@/lib/kivo-assets";
import { logError } from "@/lib/log";

/** `/social` had a flat `.limit(50)` with no way to page further
 * (RECOMMENDATIONS item 119). 20 per page, offset-based "Load more" — same
 * shape as LEAGUES_PAGE_SIZE / TEAMS_PAGE_SIZE (see
 * app/(app)/leagues/constants.ts). */
export const SOCIAL_PAGE_SIZE = 20;

export type PollOption = { id: string; label: string; position: number; voteCount: number };

/** Migration 0078's templated kinds. Null for a freeform poll somebody typed
 * — which is most of them, and is not a lesser kind of poll, just an
 * unstructured one. */
export type PollKind = "motm" | "referee_decision";

export type PollSummary = {
  options: PollOption[];
  /** What question this poll is asking, when KIVO seeded it from a template.
   * A Room's man-of-the-match vote is the only thing a MOTM *prediction* can
   * be settled against (see src/lib/predictions.ts), so it has to be
   * identifiable as one long after it was posted. */
  kind: PollKind | null;
  totalVotes: number;
  viewerOptionId: string | null;
  /** True when `get_poll_results` failed for this post, as opposed to the
   * poll genuinely having no votes yet.
   *
   * docs/BUG_AUDIT_2026-08-18.md S5: the RPC's error used to be destructured
   * away, which made those two states identical — a poll with 400 real votes
   * rendered as "0 votes" with 0% on every bar. On a platform whose stated
   * promise is never presenting invented data, confidently showing zeros it
   * does not have is the worst available failure mode. PollBlock says
   * "couldn't load results" instead. */
  resultsUnavailable: boolean;
};

/**
 * The fixture a post is attached to, for the entity card `PostCard` renders
 * above the body.
 *
 * `posts.fixture_id` has existed since migration 0001 and has always meant
 * "this is a Match Room post" — it was simply never *read* outside the Room
 * itself, so a Room post surfacing in the general feed (which it always
 * could: the feed query never filtered `fixture_id` out) arrived with no way
 * to tell what match it was about. This is that missing context, and it is
 * entirely rows KIVO already stores.
 */
export type PostFixture = {
  id: string;
  kickoffAt: string;
  status: FixtureStatus;
  homeScore: number | null;
  awayScore: number | null;
  homeName: string;
  homeShortName: string | null;
  homeCrestUrl: string | null;
  awayName: string;
  awayShortName: string | null;
  awayCrestUrl: string | null;
  competitionName: string | null;
};

export type PostListItem = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  authorUsername: string | null;
  authorAvatarSrc: string | null;
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
  /** RECOMMENDATIONS item 254: true only for a KIVO-authored automatic
   * goal/red-card announcement (posts.is_system, migration
   * 0047_match_room_system_posts) — false for every real user's post,
   * general-feed or Room alike. Drives the "KIVO" system badge in
   * PostCard/MatchRoomTab; never settable by a client write (see the
   * migration's RLS comment). */
  isSystem: boolean;
  /** The match this post is about (`posts.fixture_id`), or null for a post
   * that is not attached to one. Null too when the fixture row itself could
   * not be read — the card is simply not drawn, rather than drawn with the
   * parts that did load. */
  fixture: PostFixture | null;
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
  options?: {
    fixtureId?: string;
    limit?: number;
    followingOnly?: boolean;
    /** Club mates / Rivals: posts by profiles whose favourite_team_id is this
     * club. Both filters are the same question about a different team id, so
     * they share one code path — see src/lib/social-filters.ts. */
    teamId?: string;
    postIds?: string[];
    /**
     * KIVO_NEXT_GEN KN-94. Keyset cursor: the `created_at`/`id` of the last
     * post already shown. When present it replaces offset paging entirely for
     * the general feed.
     *
     * Offset paging is wrong for a feed and the reason is not theoretical: a
     * post written between page 1 and page 2 shifts the whole window down one,
     * so the reader gets a duplicate at the top of page 2 and a post they will
     * never see falls off the bottom. A sibling fix already dedupes the
     * duplicate client-side, which hides the symptom the reader notices and
     * leaves the one they do not — the skipped post. A cursor cannot skip,
     * because it asks for "older than this exact row" rather than "rows 20-39
     * of whatever the list is right now".
     *
     * `id` is the tiebreak, not decoration: two posts can share a `created_at`
     * to the microsecond, and without a second key one of them is unreachable.
     */
    cursor?: { createdAt: string; id: string };
  },
): Promise<{
  error: string | null;
  posts: PostListItem[];
  hasMore: boolean;
  /** Pass back as `options.cursor` for the next page. Null when there is no next page. */
  nextCursor: { createdAt: string; id: string } | null;
}> {
  const limit = options?.limit ?? SOCIAL_PAGE_SIZE;
  const supabase = createServerSupabaseClient();

  /**
   * The fixture is an embed rather than a second query keyed on `fixture_id`:
   * `fixtures_select_public` makes it readable to the same viewer the post is,
   * so PostgREST can join it in the round trip that is already happening. The
   * embed is null for an ordinary post and for a post whose fixture has since
   * been deleted, which is exactly the two cases that must render no card.
   */
  type PostRow = {
    id: string;
    body: string;
    created_at: string;
    author_profile_id: string;
    is_system: boolean;
    poll_kind: PollKind | null;
    fixture: {
      id: string;
      kickoff_at: string;
      status: FixtureStatus;
      home_score: number | null;
      away_score: number | null;
      // Non-null because the FKs are: `fixtures.home_team_id`,
      // `away_team_id` and `competition_id` are all NOT NULL in migration
      // 0001, and PostgREST types the embed accordingly. `toPostFixture`
      // still guards at runtime — a generated type is a claim about the
      // schema, not about the row that came back.
      home_team: { name: string; short_name: string | null; crest_url: string | null };
      away_team: { name: string; short_name: string | null; crest_url: string | null };
      competition: { name: string; short_name: string | null };
    } | null;
  };

  const POST_SELECT = `id, body, created_at, author_profile_id, is_system, poll_kind,
     fixture:fixtures(
       id, kickoff_at, status, home_score, away_score,
       home_team:teams!fixtures_home_team_id_fkey(name, short_name, crest_url),
       away_team:teams!fixtures_away_team_id_fkey(name, short_name, crest_url),
       competition:competitions(name, short_name)
     )`;
  let pageRows: PostRow[];
  let hasMore = false;

  if (options?.postIds) {
    // RECOMMENDATIONS item 173: /saved passes an explicit, already-ordered,
    // bounded set of post ids (most-recently-saved first) instead of a feed
    // page — no offset/range pagination, no followingOnly/fixtureId
    // filtering, just hydrate exactly these posts with the same joins every
    // other caller gets. Not is_system-filtered either (unlike the plain
    // feed query below) — this is "give me exactly this post id back",
    // e.g. a notification deep-link, and should resolve regardless of who
    // authored it.
    if (options.postIds.length === 0) return { error: null, posts: [], hasMore: false, nextCursor: null };
    const { data, error } = await supabase
      .from("posts")
      .select(POST_SELECT)
      .in("id", options.postIds);
    if (error) {
      logError("social.posts.load", error);
      return { error: "Couldn't load posts. Try again.", posts: [], hasMore: false, nextCursor: null };
    }
    const rowById = new Map((data ?? []).map((p) => [p.id, p]));
    // .in() doesn't guarantee the result order matches the input array, so
    // the caller's real ordering (by save recency) is restored here.
    pageRows = options.postIds.map((id) => rowById.get(id)).filter((p): p is PostRow => !!p);
  } else if (options?.teamId) {
    // Club mates / Rivals. The join this needs — posts to profiles, filtered
    // on someone else's favourite_team_id — crosses an RLS boundary:
    // profiles_select_own_or_admin restricts a plain select on `profiles` to
    // the caller's own row, so doing this client-side would silently return
    // zero rows forever rather than error. get_team_feed_post_ids (migration
    // 0068) is the narrow SECURITY DEFINER read for it, and restates
    // posts_select_public's shadow-mute predicate by hand, since a definer
    // function bypasses the policy that would otherwise apply it.
    //
    // It returns ids only, hydrated below by exactly the same joins every
    // other post on this page gets — so a Club mates card and an All card are
    // the same card.
    const { data: idRows, error: idError } = await supabase.rpc("get_team_feed_post_ids", {
      p_team_id: options.teamId,
      p_offset: offset,
      p_limit: limit + 1,
    });
    if (idError) {
      logError("social.posts.teamFeed", idError);
      return { error: "Couldn't load posts. Try again.", posts: [], hasMore: false, nextCursor: null };
    }
    const orderedIds = (idRows ?? []).map((row) => row.post_id);
    hasMore = orderedIds.length > limit;
    const pageIds = orderedIds.slice(0, limit);
    if (pageIds.length === 0) return { error: null, posts: [], hasMore: false, nextCursor: null };

    const { data, error } = await supabase
      .from("posts")
      .select(POST_SELECT)
      .in("id", pageIds);
    if (error) {
      logError("social.posts.teamFeedHydrate", error);
      return { error: "Couldn't load posts. Try again.", posts: [], hasMore: false, nextCursor: null };
    }
    // .in() does not preserve the input order, and the RPC's ordering (newest
    // first) is the whole point of asking it.
    const rowById = new Map((data ?? []).map((row) => [row.id, row]));
    pageRows = pageIds.map((id) => rowById.get(id)).filter((row): row is PostRow => Boolean(row));
  } else {
    // RECOMMENDATIONS item 175: `followed_type = 'user'` (the
    // follow_target_type enum already supports it — see 0001) filtered to
    // posts by the profiles the viewer actually follows. A signed-out viewer
    // can't follow anyone, so this resolves to "nobody" rather than silently
    // falling back to the full feed.
    let followedAuthorIds: string[] | null = null;
    if (options?.followingOnly) {
      if (!viewerProfileId) return { error: null, posts: [], hasMore: false, nextCursor: null };
      const { data: followRows } = await supabase
        .from("follows")
        .select("followed_id")
        .eq("follower_profile_id", viewerProfileId)
        .eq("followed_type", "user");
      followedAuthorIds = (followRows ?? []).map((f) => f.followed_id);
      // .in("author_profile_id", []) would send a malformed `in.()` filter to
      // PostgREST — short-circuit instead of ever sending that.
      if (followedAuthorIds.length === 0) return { error: null, posts: [], hasMore: false, nextCursor: null };
    }

    let query = supabase
      .from("posts")
      .select(POST_SELECT)
      // `id` desc is part of the sort, not a flourish: it is what makes the
      // keyset comparison below a total order, so no post can hide behind
      // another with an identical timestamp.
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    // SECURITY_REVIEW.md F10. `.or()` takes a hand-built string, unlike
    // `.eq()` and `.ilike()` which bind their values — so anything
    // interpolated here lands in PostgREST filter SYNTAX, not in a parameter.
    // This cursor comes from the client, and the argument that it is safe to
    // accept was right about the VALUES and missed where they end up.
    //
    // Rather than shape-test the strings and pass them through, both halves
    // are rebuilt from parsed values: the id must be a uuid, and the timestamp
    // is re-serialised from a parsed Date. So what reaches the filter is a
    // string this code constructed, not one the caller sent. A malformed
    // cursor falls through to the first page — a caller who tampers with it
    // gets ordinary results rather than an error that would tell them their
    // input reached the query planner.
    const cursor = options?.cursor;
    const cursorAt = cursor ? new Date(cursor.createdAt) : null;
    const cursorIsUsable = Boolean(cursor && isUuid(cursor.id) && cursorAt && !Number.isNaN(cursorAt.getTime()));

    if (cursor && cursorIsUsable && cursorAt) {
      // "Strictly older than the last row I showed" — the tuple comparison
      // (created_at, id) < (cursor.createdAt, cursor.id), written the way
      // PostgREST expresses it. Immune to rows being inserted while the reader
      // is paging, which is exactly what offset paging is not.
      const at = cursorAt.toISOString();
      query = query.or(`created_at.lt.${at},and(created_at.eq.${at},id.lt.${cursor.id})`).limit(limit + 1);
    } else {
      query = query.range(offset, offset + limit);
    }

    if (options?.fixtureId) {
      query = query.eq("fixture_id", options.fixtureId);
    } else {
      // RECOMMENDATIONS item 254: system-authored goal/red-card
      // announcements are real content, but belong only inside their own
      // fixture's Room, not the unscoped general feed. Pre-existing
      // behaviour already lets an ordinary *human* Room post show up in
      // /social too (fetchPostsPage never filtered fixture_id out of the
      // general query, and fixing that is a separate, unscoped product
      // decision this task didn't ask for) — this narrowly excludes only
      // the new is_system content, so /social doesn't fill up with a
      // repetitive auto-generated alert for every goal in every live match
      // at once. Scoped to `!options?.fixtureId` specifically so Match
      // Room's own fetch (which always passes fixtureId) is untouched —
      // that's the one place these posts must always appear.
      query = query.eq("is_system", false);
    }
    if (followedAuthorIds) query = query.in("author_profile_id", followedAuthorIds);

    const { data: rows, error } = await query;
    if (error) {
      logError("social.posts.load", error);
      return { error: "Couldn't load posts. Try again.", posts: [], hasMore: false, nextCursor: null };
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

  const [
    { data: viewerReactions },
    { data: authors },
    { data: engagement },
    { data: pollOptionRows },
    { data: saveRows },
  ] = await Promise.all([
    // KIVO_NEXT_GEN KN-13: only the *viewer's own* reaction rows now. The
    // totals come from get_post_engagement below — this query used to fetch
    // every reaction row on the page purely so both could be derived from it,
    // which meant a genuinely popular post transferred thousands of rows to
    // produce one integer. Scoped to the viewer, the row count is bounded by
    // the page size no matter how popular anything on it is. A signed-out
    // viewer has no reactions at all, so the query is skipped entirely.
    postIds.length && viewerProfileId
      ? supabase
          .from("reactions")
          .select("target_id, profile_id, reaction_type")
          .eq("target_type", "post")
          .eq("profile_id", viewerProfileId)
          .in("target_id", postIds)
      : Promise.resolve({ data: [] }),
    authorIds.length ? supabase.rpc("get_public_profiles", { p_ids: authorIds }) : Promise.resolve({ data: [] }),
    // KIVO_NEXT_GEN KN-13: reaction and comment totals as two integers per
    // post, counted in Postgres against real indexes (idx_reactions_target,
    // idx_comments_post_id), instead of shipping one row per reaction and one
    // row per comment across the wire to be counted in JavaScript. The RPC is
    // deliberately SECURITY INVOKER — comments/reactions are public selects
    // that migration 0045 narrowed to hide shadow-muted authors, and a
    // definer function would have quietly counted those rows back in. See
    // migration 0060 for the full reasoning.
    postIds.length
      ? supabase.rpc("get_post_engagement", { p_post_ids: postIds })
      : Promise.resolve({ data: [] as { post_id: string; reaction_count: number; comment_count: number }[] }),
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
  // aggregateReactions still owns "which reaction did the viewer pick", which
  // is what the viewer-scoped query above is for; the counts it would also
  // have derived now come from the RPC instead.
  const viewerReactionByPost = aggregateReactions(viewerReactions ?? [], viewerProfileId);

  const reactionCountByPost = new Map<string, number>();
  const commentCountByPost = new Map<string, number>();
  for (const row of engagement ?? []) {
    reactionCountByPost.set(row.post_id, row.reaction_count);
    commentCountByPost.set(row.post_id, row.comment_count);
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
  // reasoning as predictions/get_prediction_consensus above it.
  //
  // KIVO_NEXT_GEN KN-14: one RPC for the whole page, not one per poll. The
  // per-poll loop this replaces argued polls would be a small minority of any
  // page — true for /social, and not true for a Match Room during a live
  // match, which is exactly where RECOMMENDATIONS.md item 306 wants polls to
  // live. The assumption was fair when it was written and stops being fair
  // precisely when the feature starts working. Migration 0060 adds the
  // single-signature array RPC (see migration 0063 for why it is not an
  // overload of the scalar one), matching get_prediction_consensus's shape.
  const [pollResults, viewerVoteRows] = await Promise.all([
    pollPostIds.length
      ? supabase.rpc("get_poll_results_for_posts", { p_post_ids: pollPostIds })
      : Promise.resolve({ data: [] as { post_id: string; option_id: string; vote_count: number }[], error: null }),
    pollPostIds.length && viewerProfileId
      ? supabase.from("poll_votes").select("post_id, option_id").eq("profile_id", viewerProfileId).in("post_id", pollPostIds)
      : Promise.resolve({ data: [] as { post_id: string; option_id: string }[] }),
  ]);

  // null (not []) still distinguishes "the RPC failed" from "nobody has voted"
  // — the distinction docs/BUG_AUDIT_2026-08-18.md S5 exists to protect, now
  // applied to the whole page at once rather than per poll. One failure means
  // no poll on the page can be shown as a real result, which is the honest
  // read of what just happened.
  const pollResultsByPost = new Map<string, { option_id: string; vote_count: number }[] | null>();
  if (pollResults.error) {
    logError("social.getPollResults", pollResults.error, { postIds: pollPostIds.join(",") });
    for (const postId of pollPostIds) pollResultsByPost.set(postId, null);
  } else {
    for (const postId of pollPostIds) pollResultsByPost.set(postId, []);
    for (const row of pollResults.data ?? []) {
      pollResultsByPost.get(row.post_id)?.push({ option_id: row.option_id, vote_count: row.vote_count });
    }
  }
  const viewerVoteByPost = new Map((viewerVoteRows.data ?? []).map((v) => [v.post_id, v.option_id]));
  const savedPostIds = new Set((saveRows ?? []).map((s) => s.target_id));

  // KN-94: the cursor is the *last row actually served*, so the next request
  // resumes exactly where this one stopped regardless of what was written in
  // between. Null when there is no next page, which is what stops a caller
  // asking for one.
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && lastRow ? { createdAt: lastRow.created_at, id: lastRow.id } : null;

  return {
    error: null,
    hasMore,
    nextCursor,
    posts: pageRows.map((post) => {
      const viewerReactionSummary = viewerReactionByPost.get(post.id) ?? { count: 0, viewerReaction: null };
      const author = authorById.get(post.author_profile_id);
      const options = pollOptionsByPost.get(post.id);
      const results = pollResultsByPost.get(post.id) ?? null;
      const voteCountByOption = new Map((results ?? []).map((r) => [r.option_id, r.vote_count]));
      const poll: PollSummary | null = options
        ? {
            kind: post.poll_kind,
            options: options.map((option) => ({
              id: option.id,
              label: option.label,
              position: option.position,
              voteCount: voteCountByOption.get(option.id) ?? 0,
            })),
            totalVotes: (results ?? []).reduce((sum, r) => sum + r.vote_count, 0),
            viewerOptionId: viewerVoteByPost.get(post.id) ?? null,
            resultsUnavailable: results === null,
          }
        : null;
      return {
        id: post.id,
        body: post.body,
        createdAt: post.created_at,
        authorName: author?.display_name || author?.username || "KIVO fan",
        authorUsername: author?.username ?? null,
        authorAvatarSrc: author ? resolveAvatarSrc(author) : null,
        reactionCount: reactionCountByPost.get(post.id) ?? 0,
        viewerReaction: viewerReactionSummary.viewerReaction,
        commentCount: commentCountByPost.get(post.id) ?? 0,
        poll,
        viewerSaved: savedPostIds.has(post.id),
        isSystem: post.is_system,
        fixture: toPostFixture(post.fixture),
      };
    }),
  };
}

/**
 * The embedded fixture row, narrowed to what a post's entity card renders.
 *
 * Both teams are required: a fixture with one side missing is not a match, it
 * is half a row, and half a card claiming to be a fixture is worse than no
 * card. Returns null in that case, which is the same thing an ordinary post
 * returns.
 */
function toPostFixture(row: PostRowFixture): PostFixture | null {
  if (!row?.home_team || !row.away_team) return null;
  return {
    id: row.id,
    kickoffAt: row.kickoff_at,
    status: row.status,
    homeScore: row.home_score,
    awayScore: row.away_score,
    homeName: row.home_team.name,
    homeShortName: row.home_team.short_name,
    homeCrestUrl: row.home_team.crest_url,
    awayName: row.away_team.name,
    awayShortName: row.away_team.short_name,
    awayCrestUrl: row.away_team.crest_url,
    competitionName: row.competition?.short_name ?? row.competition?.name ?? null,
  };
}

type PostRowFixture = {
  id: string;
  kickoff_at: string;
  status: FixtureStatus;
  home_score: number | null;
  away_score: number | null;
  home_team: { name: string; short_name: string | null; crest_url: string | null };
  away_team: { name: string; short_name: string | null; crest_url: string | null };
  competition: { name: string; short_name: string | null };
} | null;
