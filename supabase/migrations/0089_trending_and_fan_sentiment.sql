-- =============================================================================
-- Trending discussions and fan sentiment, both from rows that really exist
-- =============================================================================
-- Both of these are named in the founding brief, and both are the kind of
-- feature that is trivial to fake and worth nothing faked. "Trending" is the
-- single most common place a product invents engagement, and a sentiment score
-- with no real votes underneath it is just a number with a nice colour.
--
-- So the rule this migration is built to hold: every figure returned here is a
-- COUNT of rows a real person created, inside a window the caller states, and
-- there is no weighting, no decay curve, no velocity and no score. A count and
-- a window are things a reader can check. A "trend score" is not.
--
-- KIVO already applied this rule once, and it is worth restating because this
-- migration is where the temptation returns: `/search` and the command palette
-- deliberately say "Popular", never "Trending", because a follower total is
-- not a time-windowed signal (see search-actions.ts). These functions ARE
-- time-windowed, off `posts.created_at` and `comments.created_at`, which is
-- what earns the word here.
--
-- WHAT IS RANKED. Not topics — KIVO has no tags, and inferring a topic from
-- post text would be exactly the kind of invented signal this file exists to
-- avoid. Two things that are really countable:
--
--   Match Rooms  `posts.fixture_id` is a real foreign key. "Which matches are
--                people actually talking about right now" is a group-by.
--   Posts        comments and reactions on one post, in a window.
--
-- WHAT IS DELIBERATELY NOT APPLIED HERE. Personal blocks (0086). These are
-- platform-level aggregates and a block is one viewer's private decision;
-- folding it in would make the count differ per reader, which is both far more
-- expensive and a worse answer to "what is the room talking about". The
-- viewer's own blocks still apply where it matters — the ranked post ids are
-- fetched back through RLS, so a blocked author's post never renders. The
-- ranking is platform truth; the display is viewer truth.
--
-- Shadow-muted authors (0045) ARE excluded, because that is not a per-viewer
-- opinion — it is KIVO's own moderation state, and letting it inflate a
-- platform-wide count would let a muted account trend.

-- -----------------------------------------------------------------------------
-- Trending Match Rooms
-- -----------------------------------------------------------------------------
-- Posts and comments are counted separately and returned separately rather
-- than summed into one figure. A room with 40 posts and no replies and a room
-- with 4 posts and 36 replies are different rooms, and the caller can say so.
-- `participant_count` is distinct authors: it is what stops one very talkative
-- person looking like a conversation, and it is a real count, not a penalty
-- term in a formula.
create or replace function public.get_trending_match_rooms(
  p_since timestamptz,
  p_limit int default 5
)
returns table (
  fixture_id        uuid,
  post_count        bigint,
  comment_count     bigint,
  participant_count bigint
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with room_posts as (
    select p.id, p.fixture_id, p.author_profile_id
    from posts p
    join profiles pr on pr.id = p.author_profile_id
    where p.fixture_id is not null
      and p.created_at >= p_since
      -- System-authored goal/red-card announcements (0047) are KIVO talking to
      -- itself. Counting them would let a busy match trend on KIVO's own posts.
      and p.is_system = false
      and private.effective_moderation_status(pr.moderation_status, pr.moderation_expires_at)
          is distinct from 'shadow_muted'
  ),
  room_comments as (
    select rp.fixture_id, c.id, c.author_profile_id
    from comments c
    join room_posts rp on rp.id = c.post_id
    join profiles pr on pr.id = c.author_profile_id
    where c.created_at >= p_since
      and private.effective_moderation_status(pr.moderation_status, pr.moderation_expires_at)
          is distinct from 'shadow_muted'
  )
  select
    f.fixture_id,
    count(*) filter (where f.kind = 'post')::bigint    as post_count,
    count(*) filter (where f.kind = 'comment')::bigint as comment_count,
    count(distinct f.author_profile_id)::bigint        as participant_count
  from (
    select fixture_id, author_profile_id, 'post'::text as kind from room_posts
    union all
    select fixture_id, author_profile_id, 'comment'::text as kind from room_comments
  ) f
  group by f.fixture_id
  -- Ordered by real people first, then by real volume. Two rooms with the same
  -- number of participants are separated by how much was actually said; the
  -- reverse would let one person's monologue outrank a conversation.
  order by count(distinct f.author_profile_id) desc, count(*) desc, f.fixture_id
  limit greatest(least(p_limit, 20), 1);
$$;

revoke execute on function public.get_trending_match_rooms(timestamptz, int) from public;
revoke execute on function public.get_trending_match_rooms(timestamptz, int) from anon;
grant execute on function public.get_trending_match_rooms(timestamptz, int) to authenticated;

-- -----------------------------------------------------------------------------
-- Trending posts
-- -----------------------------------------------------------------------------
-- Returns ids and real counts. It does not return the post, because the post
-- has to come back through RLS so that moderation, and the caller's own
-- blocks, still apply to what is displayed.
--
-- The window applies to the ENGAGEMENT, not to the post. A three-day-old take
-- that people are arguing about today is trending today; requiring the post
-- itself to be recent would be a different, and less true, statement.
create or replace function public.get_trending_posts(
  p_since timestamptz,
  p_limit int default 5
)
returns table (
  post_id        uuid,
  comment_count  bigint,
  reaction_count bigint,
  participant_count bigint
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with recent_comments as (
    select c.post_id, c.author_profile_id
    from comments c
    join profiles pr on pr.id = c.author_profile_id
    where c.created_at >= p_since
      and private.effective_moderation_status(pr.moderation_status, pr.moderation_expires_at)
          is distinct from 'shadow_muted'
  ),
  recent_reactions as (
    select r.target_id as post_id, r.profile_id as author_profile_id
    from reactions r
    where r.target_type = 'post'
      and r.created_at >= p_since
  ),
  activity as (
    select post_id, author_profile_id, 'comment'::text as kind from recent_comments
    union all
    select post_id, author_profile_id, 'reaction'::text as kind from recent_reactions
  )
  select
    a.post_id,
    count(*) filter (where a.kind = 'comment')::bigint  as comment_count,
    count(*) filter (where a.kind = 'reaction')::bigint as reaction_count,
    count(distinct a.author_profile_id)::bigint         as participant_count
  from activity a
  join posts p on p.id = a.post_id
  join profiles pr on pr.id = p.author_profile_id
  where p.is_system = false
    and private.effective_moderation_status(pr.moderation_status, pr.moderation_expires_at)
        is distinct from 'shadow_muted'
  group by a.post_id
  order by count(distinct a.author_profile_id) desc, count(*) desc, a.post_id
  limit greatest(least(p_limit, 20), 1);
$$;

revoke execute on function public.get_trending_posts(timestamptz, int) from public;
revoke execute on function public.get_trending_posts(timestamptz, int) from anon;
grant execute on function public.get_trending_posts(timestamptz, int) to authenticated;

-- -----------------------------------------------------------------------------
-- Fan sentiment
-- -----------------------------------------------------------------------------
-- Two real sources and nothing else: `fan_ratings` (a 1-5 rating of the match,
-- explicitly fan opinion and never conflated with provider data — see 0032)
-- and `poll_votes` on that fixture's Room polls.
--
-- Batched by fixture id array so a list of trending rooms costs one round trip
-- rather than one per room, matching get_prediction_consensus's shape.
--
-- Returns raw counts and a raw average. It does NOT return a label — no
-- "positive", no "mixed", no emoji. Turning 3.4 out of 5 into a word is a
-- judgement about where the boundaries sit, and that judgement belongs
-- somewhere a reader can see it explained, not inside SQL. It also does not
-- suppress a small sample: suppression is a display decision (the same call
-- `get_fan_rating_summary` and `get_prediction_consensus` already make), and
-- the honest raw count is what lets the UI say "3 ratings, too few to mean
-- much" instead of silently rendering nothing.
create or replace function public.get_fan_sentiment(p_fixture_ids uuid[])
returns table (
  fixture_id    uuid,
  rating_count  bigint,
  avg_rating    numeric,
  poll_count    bigint,
  poll_vote_count bigint
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    f.id as fixture_id,
    coalesce(r.rating_count, 0)::bigint     as rating_count,
    r.avg_rating,
    coalesce(pl.poll_count, 0)::bigint      as poll_count,
    coalesce(pl.poll_vote_count, 0)::bigint as poll_vote_count
  from unnest(p_fixture_ids) as f(id)
  left join lateral (
    select count(*)::bigint as rating_count, avg(rating)::numeric as avg_rating
    from fan_ratings fr
    where fr.fixture_id = f.id
  ) r on true
  left join lateral (
    select
      count(distinct po.id)::bigint as poll_count,
      count(pv.id)::bigint          as poll_vote_count
    from posts po
    join poll_options o on o.post_id = po.id
    left join poll_votes pv on pv.option_id = o.id
    where po.fixture_id = f.id
  ) pl on true;
$$;

revoke execute on function public.get_fan_sentiment(uuid[]) from public;
revoke execute on function public.get_fan_sentiment(uuid[]) from anon;
grant execute on function public.get_fan_sentiment(uuid[]) to authenticated;

-- Supports the windowed scans above. `created_at` already has an index on
-- posts (0001); comments and reactions did not have one usable for a
-- time-bounded scan.
create index if not exists idx_comments_created_at on comments (created_at desc);
create index if not exists idx_reactions_target_created_at
  on reactions (target_type, created_at desc);

-- To reverse:
--   drop index if exists idx_reactions_target_created_at;
--   drop index if exists idx_comments_created_at;
--   drop function if exists public.get_fan_sentiment(uuid[]);
--   drop function if exists public.get_trending_posts(timestamptz, int);
--   drop function if exists public.get_trending_match_rooms(timestamptz, int);
