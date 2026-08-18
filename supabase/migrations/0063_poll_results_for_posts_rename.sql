-- KIVO_NEXT_GEN KN-14, follow-up to 0060.
--
-- 0060 added the batched poll aggregate as `get_poll_results(p_post_ids uuid[])`,
-- an overload of the existing `get_poll_results(p_post_id uuid)` from 0032. That
-- matched the item's suggestion and it works fine in Postgres — it does not work
-- in the type layer. Supabase's type generator represents two same-named
-- functions as a **union** of `{ Args, Returns }` shapes, and supabase-js's
-- `.rpc()` collapses that union when resolving the argument type, so passing
-- `uuid[]` is rejected against the scalar overload's `Args`. There is no cast
-- that makes that honest rather than silenced.
--
-- So: one name, one signature — which is what every other aggregate in this
-- schema already does (get_prediction_consensus, get_fan_rating_summary,
-- get_public_profiles are each a single signature taking an array).
--
-- The scalar `get_poll_results(uuid)` is deliberately LEFT IN PLACE. It has no
-- callers in `src/` any more, but 0059 (`close_the_anon_surface`, written
-- concurrently with this in a sibling session) contains
-- `revoke execute on function public.get_poll_results(uuid) from anon;` —
-- dropping it here would make that migration fail for anyone replaying this
-- history from scratch. Removing it is a separate, safe cleanup once both
-- migrations are settled, and is not worth breaking a replay for.

drop function if exists public.get_poll_results(uuid[]);

create or replace function public.get_poll_results_for_posts(p_post_ids uuid[])
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

revoke execute on function public.get_poll_results_for_posts(uuid[]) from public;
revoke execute on function public.get_poll_results_for_posts(uuid[]) from anon;
grant execute on function public.get_poll_results_for_posts(uuid[]) to authenticated;

-- To reverse: drop function public.get_poll_results_for_posts(uuid[]);
