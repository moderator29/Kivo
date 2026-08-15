-- RECOMMENDATIONS.md section 8, items 168/170/172/173: four independent
-- pieces of new real-user-generated-data schema, batched into one migration
-- because they're all small and none depends on the others.
--
--   168. Prediction consensus  -> get_prediction_consensus() RPC (no new table;
--        predictions already exists, this just exposes a narrow aggregate the
--        same way get_predictions_leaderboard does, since predictions_select_own
--        blocks a plain cross-user query).
--   170. Fan match ratings     -> fan_ratings table + get_fan_rating_summary() RPC.
--   172. Poll posts            -> poll_options + poll_votes tables + get_poll_results() RPC.
--   173. Saved posts/watchlists -> save_target_type enum + saves table (mirrors follows exactly).
--
-- Every new owner-scoped table below follows the same shape already
-- established by `predictions` and `follows` in 0001: RLS restricts a plain
-- client select/insert/update/delete to the caller's own rows
-- (private.current_profile_id()), and any cross-user aggregate a feature
-- needs is exposed through a narrow SECURITY DEFINER function that returns
-- only counts/aggregates, never another user's individual pick — same
-- reasoning as get_predictions_leaderboard (0012) and get_public_profiles.

-- =============================================================================
-- 168. Prediction consensus
-- =============================================================================
-- predictions_select_own (0001) restricts a plain select to the caller's own
-- rows, so "62% of KIVO users picked a home win" can't be built from a plain
-- client query. Batched by fixture id array (not one fixture at a time) so
-- the /predictions list page can fetch consensus for every card on screen in
-- one round trip instead of N. The caller (UI) is responsible for suppressing
-- the display below a real minimum sample size — this returns real,
-- unsuppressed per-outcome counts, same as get_predictions_leaderboard
-- returns real summed points; suppression is a display decision, not a data
-- one, same pattern as HeadToHeadCard showing the real "2 meetings" count
-- while declining to call it a record.
create or replace function public.get_prediction_consensus(p_fixture_ids uuid[])
returns table (
  fixture_id        uuid,
  predicted_outcome prediction_outcome,
  pick_count        bigint
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select fixture_id, predicted_outcome, count(*)::bigint as pick_count
  from predictions
  where fixture_id = any(p_fixture_ids)
  group by fixture_id, predicted_outcome;
$$;

revoke execute on function public.get_prediction_consensus(uuid[]) from public;
grant execute on function public.get_prediction_consensus(uuid[]) to anon, authenticated;

-- To reverse: drop function public.get_prediction_consensus(uuid[]).


-- =============================================================================
-- 170. Fan match ratings
-- =============================================================================
-- Rates the fixture as a whole (not a per-player rating) — the smaller,
-- cleaner scope of the two the recommendation allows ("a performance" is
-- ambiguous between "the match" and "a player in it"): a per-player rating
-- would need a player picker backed by lineups, which are only sometimes
-- synced (admin-triggered, per RECOMMENDATIONS item 167's same caveat), so
-- it would frequently have nothing to rate against. A fixture always exists.
-- Explicitly fan opinion, not a data-provider rating — never conflated with
-- fixture_statistics (real provider data) anywhere this is displayed.
create table fan_ratings (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles (id) on delete cascade,
  fixture_id  uuid not null references fixtures (id) on delete cascade,
  rating      smallint not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint fan_ratings_unique_per_fixture unique (profile_id, fixture_id),
  constraint fan_ratings_rating_range check (rating between 1 and 5)
);

create trigger trg_fan_ratings_updated_at before update on fan_ratings
  for each row execute function set_updated_at();

create index idx_fan_ratings_fixture_id on fan_ratings (fixture_id);
create index idx_fan_ratings_profile_id on fan_ratings (profile_id);

alter table fan_ratings enable row level security;

create policy fan_ratings_select_own on fan_ratings
  for select to authenticated
  using (profile_id = private.current_profile_id());

-- WITH CHECK requires the fixture to actually be finished ("rate a
-- performance after the whistle") — enforced in RLS itself, not just the
-- server action, same reasoning as predictions_update_own_unlocked encoding
-- the lock-at-kickoff rule directly into the policy rather than trusting the
-- client. fixtures_select_public (0001's football-data DO block) makes this
-- subquery readable by any authenticated caller regardless of who rated.
create policy fan_ratings_insert_own on fan_ratings
  for insert to authenticated
  with check (
    profile_id = private.current_profile_id()
    and exists (select 1 from fixtures f where f.id = fixture_id and f.status = 'finished')
  );

create policy fan_ratings_update_own on fan_ratings
  for update to authenticated
  using (profile_id = private.current_profile_id())
  with check (profile_id = private.current_profile_id());

create policy fan_ratings_delete_own on fan_ratings
  for delete to authenticated
  using (profile_id = private.current_profile_id());

-- Public aggregate: count + average only, never an individual rating (same
-- narrow-RPC shape as get_predictions_leaderboard). The UI suppresses
-- presenting the average as meaningful below a minimum real sample (item
-- 170's explicit "don't show 100% off one vote" rule) but the real count is
-- always safe to show honestly, same as HeadToHeadCard.
create or replace function public.get_fan_rating_summary(p_fixture_id uuid)
returns table (
  rating_count bigint,
  avg_rating   numeric
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select count(*)::bigint as rating_count, avg(rating)::numeric as avg_rating
  from fan_ratings
  where fixture_id = p_fixture_id;
$$;

revoke execute on function public.get_fan_rating_summary(uuid) from public;
grant execute on function public.get_fan_rating_summary(uuid) to anon, authenticated;

-- To reverse: drop function public.get_fan_rating_summary(uuid); drop table fan_ratings;


-- =============================================================================
-- 172. Poll posts
-- =============================================================================
-- No new column on `posts` — a poll is simply a post that has poll_options
-- rows (the post's own `body` doubles as the poll question, reusing the
-- length/required constraint posts already has rather than adding a second
-- near-duplicate text column). Kept as two small tables instead of a jsonb
-- column so per-option vote counting can stay a real `group by` + a foreign
-- key, not hand-rolled jsonb math.
create table poll_options (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references posts (id) on delete cascade,
  position    smallint not null,
  label       text not null,
  created_at  timestamptz not null default now(),
  constraint poll_options_label_length check (char_length(label) between 1 and 80),
  constraint poll_options_position_range check (position between 0 and 3),
  constraint poll_options_unique_position unique (post_id, position)
);

create index idx_poll_options_post_id on poll_options (post_id);

alter table poll_options enable row level security;

create policy poll_options_select_public on poll_options
  for select to authenticated, anon
  using (true);

-- Options are only ever inserted at post-creation time (see createPoll
-- server action) by the post's own author — checked by looking the parent
-- post up directly rather than via a SECURITY DEFINER helper, since
-- posts_select_public (0001) already makes any post readable to
-- authenticated callers.
create policy poll_options_insert_own_post on poll_options
  for insert to authenticated
  with check (
    exists (
      select 1 from posts
      where posts.id = post_id and posts.author_profile_id = private.current_profile_id()
    )
  );

-- Intentionally no update/delete policy: options are immutable once a poll
-- is posted (changing them after votes exist would silently invalidate real
-- votes already cast). The whole post (and its options, on delete cascade)
-- can still be removed by its author or a moderator via posts' own policies.


create table poll_votes (
  id          uuid primary key default gen_random_uuid(),
  -- Never trusted from the client directly — always overwritten by
  -- trg_poll_votes_set_post_id below from the real option's post_id, so a
  -- vote can never be recorded against a poll it doesn't actually belong to.
  post_id     uuid not null references posts (id) on delete cascade,
  option_id   uuid not null references poll_options (id) on delete cascade,
  profile_id  uuid not null references profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- One vote per user per poll, same shape as predictions_unique_per_fixture.
  constraint poll_votes_unique_per_user unique (post_id, profile_id)
);

create or replace function private.set_poll_vote_post_id()
returns trigger
language plpgsql
as $$
begin
  select post_id into new.post_id from poll_options where id = new.option_id;
  if new.post_id is null then
    raise exception 'poll option % does not exist', new.option_id;
  end if;
  return new;
end;
$$;

-- BEFORE INSERT so the derived post_id is what the unique constraint and
-- ON CONFLICT (used when a user changes their vote) actually see — a client
-- cannot spoof post_id to attach a vote to the wrong poll, or to the right
-- poll via the wrong option, because this always re-derives it server-side.
create trigger trg_poll_votes_set_post_id before insert on poll_votes
  for each row execute function private.set_poll_vote_post_id();

create index idx_poll_votes_post_id on poll_votes (post_id);
create index idx_poll_votes_option_id on poll_votes (option_id);

alter table poll_votes enable row level security;

-- Mirrors predictions' one-pick-per-user shape exactly: a plain select is
-- restricted to the caller's own vote (never another user's individual
-- pick), matching predictions_select_own. voteOnPoll (the server action)
-- deletes-then-inserts to change a vote, same convention as setReaction.
create policy poll_votes_select_own on poll_votes
  for select to authenticated
  using (profile_id = private.current_profile_id());

create policy poll_votes_insert_own on poll_votes
  for insert to authenticated
  with check (profile_id = private.current_profile_id());

create policy poll_votes_delete_own on poll_votes
  for delete to authenticated
  using (profile_id = private.current_profile_id());

-- Public aggregate: option_id + a real vote count only, left-joined so an
-- option with zero votes still appears at 0 rather than being omitted (a
-- missing row would be indistinguishable from "not voted on yet" vs.
-- "genuinely zero votes"). No individual profile_id is ever exposed by this
-- function, same shape as get_predictions_leaderboard/get_poll_results'
-- siblings above.
create or replace function public.get_poll_results(p_post_id uuid)
returns table (
  option_id  uuid,
  vote_count bigint
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select o.id as option_id, count(v.id)::bigint as vote_count
  from poll_options o
  left join poll_votes v on v.option_id = o.id
  where o.post_id = p_post_id
  group by o.id
  order by o.position;
$$;

revoke execute on function public.get_poll_results(uuid) from public;
grant execute on function public.get_poll_results(uuid) to anon, authenticated;

-- To reverse: drop function public.get_poll_results(uuid); drop table poll_votes;
-- drop function private.set_poll_vote_post_id(); drop table poll_options.


-- =============================================================================
-- 173. Saved posts and player/team watchlists
-- =============================================================================
-- Exact mirror of `follows` (0001): same polymorphic (target_type, target_id)
-- shape, same RLS (own-row select/insert/delete only), same "no DB-level FK
-- across the polymorphic id because there's no single target table" caveat.
-- A distinct enum/table from `follows` rather than reusing it: saving a post
-- is a different relationship than following a team/player/competition/user
-- (a save has no "conversation" semantics, and posts were never a follows
-- target type), so folding it into follows would conflate two different
-- concepts under one unique constraint.
create type save_target_type as enum ('post', 'team', 'player');

create table saves (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles (id) on delete cascade,
  target_type save_target_type not null,
  target_id   uuid not null, -- polymorphic: posts/teams/players(id) depending on target_type
  created_at  timestamptz not null default now(),
  constraint saves_unique unique (profile_id, target_type, target_id)
);

create index idx_saves_profile on saves (profile_id);
create index idx_saves_target on saves (target_type, target_id);

alter table saves enable row level security;

create policy saves_select_own on saves
  for select to authenticated
  using (profile_id = private.current_profile_id());

create policy saves_insert_own on saves
  for insert to authenticated
  with check (profile_id = private.current_profile_id());

create policy saves_delete_own on saves
  for delete to authenticated
  using (profile_id = private.current_profile_id());

-- To reverse: drop table saves; drop type save_target_type.
