-- =============================================================================
-- Two things the notification system was missing: a dedupe guarantee, and
-- "this club, not that one"
-- =============================================================================
-- The founding brief's notification section lists triggers and then the harder
-- half: per-team, per-player and per-competition preferences, timezone
-- awareness, deduplication, deep links, priority levels and personalised copy.
-- Quiet hours and priority landed in 0088. Deep links and personalised copy are
-- real (notification-registry.ts builds both per type). Timezone awareness came
-- with 0054. This migration is the two that were not there.
--
-- -----------------------------------------------------------------------------
-- 1. Deduplication, as a constraint rather than as care
-- -----------------------------------------------------------------------------
-- Every producer today dedupes correctly, and every one of them does it with an
-- in-memory `Set` inside a single function call. That covers the case it was
-- written for — a user who both favourites a club and follows the scorer gets
-- one row, not two — and covers nothing else.
--
-- What it cannot cover, by construction:
--
--   * A retry. `dispatchStatusNotifications` catches and logs per fixture, and
--     a sync that is re-run after a partial failure walks the same transitions
--     again.
--   * A status flap. `notifyFixtureStatusChange` only checks that the new
--     status differs from the previous one, so live -> halftime -> live ->
--     halftime is two half-time notifications for one half time.
--   * A second producer added later that happens to overlap an existing one.
--     Nothing in the schema would notice.
--
-- The same goal reaching one person twice is the fastest way to lose the
-- notification permission entirely, so this stops being a matter of every
-- producer remembering, and becomes a unique index.
--
-- NULLS DISTINCT (the default) is what makes one plain index enough: rows with
-- a null `dedupe_key` never conflict with each other, so a producer that has no
-- meaningful identity to offer — a social reply, say, where two genuinely
-- separate replies are two genuinely separate notifications — simply leaves it
-- null and behaves exactly as before. A partial index would have been the
-- obvious reach here and is the wrong one: PostgREST cannot emit the matching
-- `WHERE` clause on `ON CONFLICT`, so the constraint would exist and never be
-- usable from the client library.
alter table notifications add column if not exists dedupe_key text;

comment on column notifications.dedupe_key is
  'Stable identity of the real-world event this notification is about, scoped to one recipient. Null means "no meaningful identity" and never deduplicates. Producers build it from the event''s own natural key, never from a timestamp — see buildDedupeKey in src/lib/notification-payloads.ts.';

create unique index if not exists idx_notifications_dedupe_key
  on notifications (profile_id, dedupe_key);

-- -----------------------------------------------------------------------------
-- 2. Per-entity notification mutes
-- -----------------------------------------------------------------------------
-- The honest audit: KIVO has exactly one switch for all nine match notification
-- types (`match_alerts_enabled`), plus `follows.muted` — a per-follow toggle
-- rendered next to the follow star.
--
-- That leaves two holes, and the first one is the one a real fan hits.
--
--   * A **favourite club cannot be muted at all.** `teamAudience` builds its
--     audience from `profiles.favourite_team_id` *plus* `follows`, and only the
--     `follows` half has a `muted` column. The club a person cares most about
--     is the one club they cannot turn down.
--   * **Competitions have no notification control whatsoever.** `follows`
--     has carried `followed_type = 'competition'` since 0001 and no producer
--     has ever consulted it, so "keep the league, silence the cup" — the single
--     most common thing anyone actually wants from this — was unexpressible.
--
-- A mute is deliberately NOT a follow. You can want a club's notifications off
-- without unfollowing it, and — the case that matters here — you can want them
-- off for an entity you never followed in the first place, which is exactly the
-- position a favourite club and an unfollowed competition are both in. So this
-- is its own table rather than another column on `follows`.
--
-- `follows.muted` is deliberately left alone and still honoured. It belongs to
-- the follow-star UI and to whoever owns it; the audience filter treats a row
-- here OR a muted follow as muted, because honouring only one of them would
-- silently un-mute something a user has already turned off. Nothing that is
-- muted today becomes unmuted by this migration.
--
-- Shape is an exact mirror of `saves` (0032), which is itself an exact mirror of
-- `follows`: same polymorphic (target_type, target_id), same owner-only RLS,
-- same "no DB-level FK across the polymorphic id because there is no single
-- target table" caveat.
create table if not exists notification_mutes (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles (id) on delete cascade,
  target_type follow_target_type not null,
  target_id   uuid not null, -- polymorphic: teams/players/competitions(id) by target_type
  created_at  timestamptz not null default now(),
  constraint notification_mutes_unique unique (profile_id, target_type, target_id),
  -- 'user' is a real follow_target_type and is deliberately refused here.
  -- Silencing a person is blocking, which KIVO already has as its own feature
  -- with its own reciprocal-visibility rules (0086) — letting it be expressed
  -- a second way through a notification setting would be a quieter, weaker
  -- block that looks like the real one.
  constraint notification_mutes_target_kind check (target_type in ('team', 'player', 'competition'))
);

create index if not exists idx_notification_mutes_profile on notification_mutes (profile_id);
create index if not exists idx_notification_mutes_target on notification_mutes (target_type, target_id);

alter table notification_mutes enable row level security;

create policy notification_mutes_select_own on notification_mutes
  for select to authenticated
  using (profile_id = private.current_profile_id());

create policy notification_mutes_insert_own on notification_mutes
  for insert to authenticated
  with check (profile_id = private.current_profile_id());

create policy notification_mutes_delete_own on notification_mutes
  for delete to authenticated
  using (profile_id = private.current_profile_id());

-- No UPDATE policy on purpose: a mute has no mutable field. Changing your mind
-- is a delete, exactly as it is for `saves` and `follows`.

-- To reverse:
--   drop table if exists notification_mutes;
--   drop index if exists idx_notifications_dedupe_key;
--   alter table notifications drop column if exists dedupe_key;
