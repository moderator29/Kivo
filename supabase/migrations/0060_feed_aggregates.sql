-- KIVO_NEXT_GEN KN-13 and KN-14: two aggregates the social feed was computing
-- by transferring rows.
--
-- Both are the same shape as the aggregates 0032 already established
-- (get_prediction_consensus, get_poll_results, get_fan_rating_summary), and
-- both take an id ARRAY, because a feed page is a page — a per-post round trip
-- is the thing being removed here, not a thing to reproduce in a new function.


-- =============================================================================
-- KN-13. Post engagement counts (reactions + comments) for a page of posts
-- =============================================================================
-- `fetchPostsPage` (src/app/(app)/social/posts.ts) counted comments by running
--   select post_id from comments where post_id in (...)
-- and counting the rows in JavaScript, and counted reactions the same way. For
-- a 20-post page of ordinary posts that is fine. For one genuinely popular post
-- it transfers thousands of rows across the wire to produce one integer, and it
-- gets worse exactly as the platform succeeds.
--
-- **Deliberately NOT `security definer`.** Every other cross-user aggregate in
-- this schema is, because the underlying table's RLS restricts a plain select
-- to the caller's own rows. These two tables are the opposite case:
-- `comments_select_public` and `reactions_select_public` are public selects
-- that 0045 narrowed to hide shadow-muted authors' rows from everyone but
-- themselves and admins. A `security definer` function would bypass that and
-- start counting shadow-muted comments back into everyone's feed — silently
-- undoing a moderation control. Running as invoker means these counts stay
-- exactly the counts the caller could have computed themselves, which is the
-- whole point: this changes where the counting happens, never what is counted.
--
-- Both counts come back from one scan of `posts` with two correlated
-- subqueries, each of which has a real index behind it
-- (idx_comments_post_id, idx_reactions_target).
create or replace function public.get_post_engagement(p_post_ids uuid[])
returns table (
  post_id        uuid,
  reaction_count bigint,
  comment_count  bigint
)
language sql
set search_path = public, pg_temp
stable
as $$
  select
    p.id as post_id,
    (select count(*) from reactions r where r.target_type = 'post' and r.target_id = p.id)::bigint as reaction_count,
    (select count(*) from comments c where c.post_id = p.id)::bigint as comment_count
  from posts p
  where p.id = any(p_post_ids);
$$;

revoke execute on function public.get_post_engagement(uuid[]) from public;
revoke execute on function public.get_post_engagement(uuid[]) from anon;
grant execute on function public.get_post_engagement(uuid[]) to authenticated;

-- Note on the anon revoke above: this project's default privileges grant
-- EXECUTE on a newly created public function to `anon`, which has bitten this
-- codebase twice already (0025's prune_sync_runs, 0050's get_my_followers) —
-- so the revoke is written explicitly rather than assumed. The app is fully
-- behind auth since 0053, so `authenticated` is the only role that needs it.


-- =============================================================================
-- KN-14. Batched poll results
-- =============================================================================
-- SUPERSEDED BY 0063: the overload created below could not be typed on the
-- client (Supabase's generator emits a union of Args/Returns shapes for two
-- same-named functions, and supabase-js's .rpc() collapses it), so 0063 drops
-- it and creates `get_poll_results_for_posts(uuid[])` instead. This block is
-- kept as written because it is what was actually applied to the database —
-- see 0063's header for the full reasoning.
-- The single-post get_poll_results(uuid) from 0032 stays exactly as it is —
-- nothing needs changing about it and it may still have callers. This is the
-- array-parameter sibling, matching get_prediction_consensus's shape, and it
-- carries `post_id` in its result so a caller can tell the rows apart.
--
-- The reason the per-poll loop had to go: `fetchPostsPage`'s own comment argued
-- polls would be a small minority of any page, which holds for /social and does
-- not hold for a Match Room during a live match — which is the exact place
-- RECOMMENDATIONS.md item 306 wants polls to live. The assumption was fair when
-- written and stops being fair precisely when the feature is working.
--
-- security definer for the same reason as its single-post sibling:
-- poll_votes_select_own restricts a plain client query to the caller's own
-- vote, so a cross-user count is not otherwise reachable. Returns counts only —
-- never a profile_id, never who voted for what.
--
-- Left-joined so an option with zero votes still comes back at 0 rather than
-- being omitted: a missing row would be indistinguishable from "not voted on
-- yet" versus "genuinely zero votes", and the feed already treats those two
-- states differently (see PollSummary.resultsUnavailable).
create or replace function public.get_poll_results(p_post_ids uuid[])
returns table (
  post_id    uuid,
  option_id  uuid,
  vote_count bigint
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select o.post_id, o.id as option_id, count(v.id)::bigint as vote_count
  from poll_options o
  left join poll_votes v on v.option_id = o.id
  where o.post_id = any(p_post_ids)
  group by o.post_id, o.id, o.position
  order by o.post_id, o.position;
$$;

revoke execute on function public.get_poll_results(uuid[]) from public;
revoke execute on function public.get_poll_results(uuid[]) from anon;
grant execute on function public.get_poll_results(uuid[]) to authenticated;

-- To reverse: drop function public.get_post_engagement(uuid[]);
--             drop function public.get_poll_results(uuid[]);
-- Neither drop affects get_poll_results(uuid), which is a separate overload.
