-- =============================================================================
-- Rate limiting — sliding-window event log
-- =============================================================================
-- Backs src/lib/rate-limit.ts's checkRateLimit(). One row per attempted
-- action; a "how many rows in the last N seconds" count against
-- (profile_id_or_ip, action, created_at) is the sliding window. Written and
-- read exclusively through the service-role client (see
-- createServiceRoleSupabaseClient in src/lib/supabase/server.ts) so it works
-- for both signed-in users (keyed by profile id) and unauthenticated guests
-- (keyed by IP, e.g. searchPlatform) — RLS can't key on IP the way it keys
-- on auth.jwt()->>'sub', so this table has no client-facing policies at all,
-- the same "trust the service role, nobody else" shape as xp_ledger's
-- no-insert-policy comment in 0001_kivo_core_schema.sql.
create table rate_limit_events (
  id                  uuid primary key default gen_random_uuid(),
  profile_id_or_ip    text not null,
  action              text not null,
  created_at          timestamptz not null default now()
);

comment on table rate_limit_events is
  'Sliding-window rate-limit log written only by the service-role client (checkRateLimit in src/lib/rate-limit.ts). No client-facing RLS policies by design — this table has nothing for anon/authenticated to read or write directly.';

-- The count-in-window query filters on all three columns together, and the
-- opportunistic cleanup in checkRateLimit deletes by created_at alone —
-- covered by the same leading-columns index (profile_id_or_ip, action) plus
-- a standalone created_at index would be redundant with the "delete stale
-- rows" pass, which scans across every key/action; keeping one composite
-- index here (mirroring idx_xp_ledger_profile_id's shape in 0001) is enough
-- since the cleanup query is opportunistic housekeeping, not a hot path.
create index idx_rate_limit_events_key_action_time
  on rate_limit_events (profile_id_or_ip, action, created_at desc);

alter table rate_limit_events enable row level security;

-- No policies at all: anon and authenticated get zero access (default deny),
-- same reasoning as xp_ledger — this is trust-sensitive bookkeeping that
-- only server-side code using the service_role key (which bypasses RLS
-- entirely) should ever touch.
