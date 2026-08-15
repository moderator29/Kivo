-- Item 44 (RECOMMENDATIONS.md): follows.followed_id is polymorphic with no FK,
-- so deleting a team/player/competition/profile left dangling follow rows.
-- One reusable trigger function, applied per target table, deletes any follows
-- row pointing at a row that's about to disappear. This is the currently-real
-- gap (profiles are hard-deleted on the Clerk user.deleted webhook) plus
-- defense-in-depth for teams/players/competitions, which have no delete path
-- in the app today but would hit the exact same dangling-row bug the moment
-- one is added.
create function cleanup_dangling_follows() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from follows
  where followed_type = tg_argv[0]::follow_target_type
    and followed_id = old.id;
  return old;
end;
$$;

-- Trigger functions can't actually be invoked outside a trigger context (Postgres
-- rejects a direct call to a function returning `trigger`), but Supabase exposes
-- every public-schema function as a PostgREST RPC endpoint by default. Revoke
-- direct EXECUTE so it doesn't show up as public API surface at all.
revoke execute on function cleanup_dangling_follows() from public, anon, authenticated;

create trigger trg_cleanup_follows_team after delete on teams
  for each row execute function cleanup_dangling_follows('team');

create trigger trg_cleanup_follows_player after delete on players
  for each row execute function cleanup_dangling_follows('player');

create trigger trg_cleanup_follows_competition after delete on competitions
  for each row execute function cleanup_dangling_follows('competition');

create trigger trg_cleanup_follows_profile after delete on profiles
  for each row execute function cleanup_dangling_follows('user');

-- Item 47: predictions.fixture_id cascaded on fixture delete, so removing (or
-- re-syncing under a new id) a fixture would silently destroy prediction
-- history and any XP already awarded for it becomes unexplainable. There is
-- no fixture-delete path in the app today, so tightening this to restrict is
-- a pure safety improvement with no current behavior change: it just makes a
-- future "delete this fixture" feature fail loudly instead of quietly
-- destroying user history, forcing an explicit admin decision at that point.
alter table predictions drop constraint predictions_fixture_id_fkey;
alter table predictions
  add constraint predictions_fixture_id_fkey
  foreign key (fixture_id) references fixtures (id) on delete restrict;

-- To reverse: drop the four triggers and cleanup_dangling_follows(), then
-- restore the fixture_id FK with `on delete cascade`.
