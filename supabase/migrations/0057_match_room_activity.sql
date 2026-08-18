-- =============================================================================
-- 0057 — get_match_room_activity: how many people are actually talking
-- =============================================================================
--
-- WHY
-- ---
-- `posts.fixture_id` has been real and indexed since 0001, and it drives the
-- entire Match Room feature — but nothing outside a fixture's own page has ever
-- read it. /matches and /live list crests, a score and a status, so a fixture
-- with a live 40-post argument in its Room looks exactly like one nobody has
-- opened (KIVO_NEXT_GEN.md KN-41). This function is what lets a list of scores
-- become a list of conversations, from rows that already exist.
--
-- WHY AN RPC AND NOT A PLAIN QUERY
-- --------------------------------
-- PostgREST has no GROUP BY, so the alternatives were N head-count round trips
-- (one per fixture on screen) or selecting every matching post id and counting
-- in JS — which silently undercounts the moment a day's rooms exceed the
-- project's max-rows ceiling. A number that quietly goes wrong at scale is
-- worse than no number, so: one batched aggregate, same shape as
-- get_prediction_consensus (0032).
--
-- WHY security invoker, NOT definer
-- ---------------------------------
-- Unlike get_prediction_consensus — which must be definer because
-- predictions_select_own hides other users' picks — posts are readable by
-- design (posts_select_public). Keeping this invoker means RLS still applies
-- underneath it, so a shadow-muted author's posts (0045) are excluded from the
-- count for everyone except that author and admins, exactly as they are
-- excluded from every other surface. A definer function would have inflated
-- "12 people are talking" with posts nobody can see.
--
-- WHY is_system IS EXCLUDED
-- -------------------------
-- 0047 lets KIVO itself author goal / red-card posts into a Room. Those are
-- the product talking, not people. Counting them would turn "8 people are
-- talking about this" into a claim about engagement that no human actually
-- made — the exact class of fabricated social proof KIVO does not ship.
-- =============================================================================

create or replace function public.get_match_room_activity(p_fixture_ids uuid[])
returns table (
  fixture_id        uuid,
  post_count        bigint,
  participant_count bigint
)
language sql
security invoker
set search_path = public, pg_temp
stable
as $$
  select
    p.fixture_id,
    count(*)::bigint                            as post_count,
    count(distinct p.author_profile_id)::bigint as participant_count
  from posts p
  where p.fixture_id = any(p_fixture_ids)
    and p.is_system = false
  group by p.fixture_id;
$$;

revoke execute on function public.get_match_room_activity(uuid[]) from public;
-- Authenticated only: the whole app is behind the door now (src/app/(app)/layout.tsx),
-- so there is no signed-out surface that needs this.
grant execute on function public.get_match_room_activity(uuid[]) to authenticated;

-- To reverse: drop function public.get_match_room_activity(uuid[]).
