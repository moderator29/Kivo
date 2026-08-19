-- =============================================================================
-- Templated Match Room polls: MOTM and referee decisions as first-class kinds
-- =============================================================================
-- The founding brief names two poll types by name — "man of the match" and
-- "referee decisions" — and KIVO has had, until now, one poll type: a freeform
-- 2-4 option question a user types out by hand. A sibling change (KN-100) added
-- template *chips* to the Room composer, which fills the same freeform fields
-- faster. That is a real improvement and it is not what the brief asks for:
-- a templated chip produces a poll KIVO cannot tell apart from any other poll
-- five seconds after it is posted, so nothing downstream can ever read it.
--
-- Two columns make the difference between "a poll someone typed" and "the
-- room's man-of-the-match vote":
--
--   posts.poll_kind         what question this poll is asking, as data.
--   poll_options.player_id  which real player an option stands for, when the
--                           option was seeded from a real synced lineup.
--
-- The second one is what makes an MOTM poll *resolvable*: an option labelled
-- "Bukayo Saka" is a string, and a string cannot be compared to a prediction,
-- a lineup row, or anything else. An option carrying a real players.id can.
--
-- Nothing here fabricates a candidate. `player_id` is only ever set from a real
-- `lineups` row for the fixture; when a fixture has no lineup synced, the MOTM
-- template falls back to the blank-options behaviour the composer already had,
-- and those options carry a null player_id — honestly "someone the author
-- typed", not "a player KIVO verified".

-- -----------------------------------------------------------------------------
-- posts.poll_kind
-- -----------------------------------------------------------------------------
-- Deliberately an enum and not free text: every value here has a real consumer
-- (the MOTM resolver in the prediction scoring pass; the Room's own rendering),
-- so a typo must be a write error rather than a poll that silently never
-- matches anything. Freeform polls keep a NULL poll_kind — that is the honest
-- representation of "a question a person asked", not a third enum value
-- pretending it is a template.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'poll_kind') then
    create type poll_kind as enum ('motm', 'referee_decision');
  end if;
end
$$;

alter table posts add column if not exists poll_kind poll_kind;

comment on column posts.poll_kind is
  'Which templated question this poll asks, when it is one. NULL for a freeform poll (the default) — never a placeholder. Only meaningful on a post that has poll_options rows.';

-- A templated poll is about one specific match, always. A "man of the match"
-- vote with no fixture attached has nothing to be about, and a referee-decision
-- poll on the general feed cannot say which decision. Enforced here rather than
-- in the server action so it holds for any writer.
alter table posts drop constraint if exists posts_poll_kind_needs_fixture;
alter table posts add constraint posts_poll_kind_needs_fixture
  check (poll_kind is null or fixture_id is not null);

-- One MOTM poll per fixture. Two competing man-of-the-match votes in one Room
-- would split the room's answer in half and leave the prediction resolver (see
-- the next migration) with no honest way to pick between them — "whichever got
-- more votes" is a coin toss dressed as a rule. Referee-decision polls are
-- deliberately NOT unique: a match can genuinely contain several disputed
-- decisions, and each deserves its own question.
create unique index if not exists idx_posts_one_motm_poll_per_fixture
  on posts (fixture_id)
  where poll_kind = 'motm';

-- Read path: "does this fixture have a templated poll, and which?" — asked by
-- the Room (to avoid offering a second MOTM poll) and by the scoring pass.
create index if not exists idx_posts_fixture_poll_kind
  on posts (fixture_id, poll_kind)
  where poll_kind is not null;

-- -----------------------------------------------------------------------------
-- poll_options.player_id
-- -----------------------------------------------------------------------------
-- ON DELETE RESTRICT, matching predictions_fixture_restrict (0020) and for the
-- same reason: silently nulling the player out of an option that real people
-- already voted on would turn a real vote into an unattributable one, and
-- cascading would delete the vote itself. A player with votes against them is a
-- player worth refusing to delete.
alter table poll_options add column if not exists player_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'poll_options_player_id_fkey'
  ) then
    alter table poll_options
      add constraint poll_options_player_id_fkey
      foreign key (player_id) references players (id) on delete restrict;
  end if;
end
$$;

comment on column poll_options.player_id is
  'The real player this option stands for, when the option was seeded from a synced lineup. NULL means the label is text the author typed — never assume a null option is "no player", it means "not a verified player".';

-- The same player must not appear twice on one poll: two options for one player
-- splits their vote and makes any winner meaningless.
create unique index if not exists idx_poll_options_unique_player_per_post
  on poll_options (post_id, player_id)
  where player_id is not null;

create index if not exists idx_poll_options_player_id on poll_options (player_id);

-- -----------------------------------------------------------------------------
-- Option count: 4 was a freeform limit, not a poll limit
-- -----------------------------------------------------------------------------
-- `poll_options_position_range check (position between 0 and 3)` encoded the
-- *composer's* 2-4 option UI as a database rule. That was right while every
-- poll was typed by hand — nobody types eleven options during a live match.
-- An MOTM poll seeded from two real starting XIs is 22 options, and it is 22
-- options precisely because KIVO is not choosing a shortlist on the voter's
-- behalf. 29 leaves headroom for both benches without becoming unbounded.
--
-- The freeform 2-4 rule does not go away — it moves to where it belongs, in
-- createPoll (src/app/(app)/social/actions.ts), which now caps by poll kind.
alter table poll_options drop constraint if exists poll_options_position_range;
alter table poll_options add constraint poll_options_position_range
  check (position between 0 and 29);

-- -----------------------------------------------------------------------------
-- Seeding a templated poll from real data
-- -----------------------------------------------------------------------------
-- The MOTM option list has to come from `lineups`, and it has to be written in
-- the same transaction as the post and its options — a post that exists with no
-- options is a broken poll, and the client-side insert-then-insert path
-- createPoll uses today can leave exactly that behind if the second insert
-- fails (it compensates with a delete, which is a best-effort apology, not a
-- guarantee).
--
-- SECURITY INVOKER on purpose, the same call this codebase already made for
-- vote_on_poll (0066): RLS is still the thing deciding whether this caller may
-- post at all, including 0045's moderation gate. This function makes the write
-- atomic; it does not make it privileged.
create or replace function public.create_templated_poll(
  p_fixture_id  uuid,
  p_poll_kind   poll_kind,
  p_question    text,
  p_labels      text[],
  p_player_ids  uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid;
  v_post_id    uuid;
  v_count      int;
begin
  v_profile_id := private.current_profile_id();
  if v_profile_id is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  v_count := coalesce(array_length(p_labels, 1), 0);
  if v_count < 2 then
    raise exception 'a poll needs at least 2 options' using errcode = 'P0001';
  end if;
  if v_count > 30 then
    raise exception 'a poll may not have more than 30 options' using errcode = 'P0001';
  end if;
  -- Both arrays are positional. A mismatch means the caller lost track of which
  -- player belongs to which label, which is worse than having no players at all.
  if coalesce(array_length(p_player_ids, 1), 0) <> v_count then
    raise exception 'labels and player ids must be the same length' using errcode = 'P0001';
  end if;

  insert into posts (author_profile_id, body, fixture_id, poll_kind)
  values (v_profile_id, p_question, p_fixture_id, p_poll_kind)
  returning id into v_post_id;

  insert into poll_options (post_id, position, label, player_id)
  select v_post_id, ordinality - 1, label, p_player_ids[ordinality]
  from unnest(p_labels) with ordinality as t(label, ordinality);

  return v_post_id;
end;
$$;

revoke execute on function public.create_templated_poll(uuid, poll_kind, text, text[], uuid[]) from public;
revoke execute on function public.create_templated_poll(uuid, poll_kind, text, text[], uuid[]) from anon;
grant execute on function public.create_templated_poll(uuid, poll_kind, text, text[], uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Reading a templated poll's result
-- -----------------------------------------------------------------------------
-- `poll_votes_select_own` (0032) means a plain client query can only ever see
-- the caller's own vote, so "who did the room pick" needs the same narrow
-- SECURITY DEFINER aggregate shape every other cross-user count in this schema
-- uses. Returns per-option counts plus the option's player_id — never a voter.
--
-- Deliberately returns raw counts and no "winner". Declaring a winner needs a
-- minimum sample and a tie rule, and both of those are judgement calls that
-- belong where they can be explained to the person reading them, not buried in
-- SQL. See resolveMotm in src/lib/predictions.ts.
create or replace function public.get_motm_poll_result(p_fixture_id uuid)
returns table (
  post_id     uuid,
  option_id   uuid,
  player_id   uuid,
  label       text,
  vote_count  bigint
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select o.post_id, o.id as option_id, o.player_id, o.label, count(v.id)::bigint as vote_count
  from posts p
  join poll_options o on o.post_id = p.id
  left join poll_votes v on v.option_id = o.id
  where p.fixture_id = p_fixture_id
    and p.poll_kind = 'motm'
  group by o.post_id, o.id, o.player_id, o.label, o.position
  order by o.position;
$$;

revoke execute on function public.get_motm_poll_result(uuid) from public;
revoke execute on function public.get_motm_poll_result(uuid) from anon;
grant execute on function public.get_motm_poll_result(uuid) to authenticated;

-- To reverse:
--   drop function if exists public.get_motm_poll_result(uuid);
--   drop function if exists public.create_templated_poll(uuid, poll_kind, text, text[], uuid[]);
--   alter table poll_options drop constraint poll_options_position_range;
--   alter table poll_options add constraint poll_options_position_range check (position between 0 and 3);
--   drop index if exists idx_poll_options_player_id;
--   drop index if exists idx_poll_options_unique_player_per_post;
--   alter table poll_options drop constraint poll_options_player_id_fkey;
--   alter table poll_options drop column player_id;
--   drop index if exists idx_posts_fixture_poll_kind;
--   drop index if exists idx_posts_one_motm_poll_per_fixture;
--   alter table posts drop constraint posts_poll_kind_needs_fixture;
--   alter table posts drop column poll_kind;
--   drop type poll_kind;
