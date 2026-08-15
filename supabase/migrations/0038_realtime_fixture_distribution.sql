-- Realtime distribution for fixtures + fixture_events, so a single upstream
-- sync (an admin's "Sync now"/reconcile action today; an automated live
-- worker later, once FOOTBALL_LIVE_POLLING_ENABLED is genuinely turned on)
-- fans out to every connected client via Supabase Realtime's Postgres
-- Changes feed, instead of each client polling API-Football itself or even
-- polling KIVO's own API. This is the "SUPABASE REALTIME -> ALL CONNECTED
-- USERS" half of the live-data architecture -- the automated upstream worker
-- itself is a separate, deliberately-not-yet-built piece (see
-- docs/LIVE_DATA.md); this migration only wires up distribution of whatever
-- writes already happen today, real or future.
--
-- fixtures/fixture_events are already public-select (RLS: "select to
-- authenticated, anon using (true)", migration 0001) -- Realtime respects
-- the same RLS policies for postgres_changes subscriptions, so this does not
-- widen read access at all, it only adds a push channel for data a client
-- could already read.
alter publication supabase_realtime add table public.fixtures;
alter publication supabase_realtime add table public.fixture_events;
