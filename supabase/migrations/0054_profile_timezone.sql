-- =============================================================================
-- KN-89: profiles.timezone — the column every timezone-shaped feature waits on
-- =============================================================================
-- Confirmed absent before writing this: every `alter table profiles` across
-- migrations 0001, 0043, 0045, 0048 and 0053 adds no timezone column, and
-- `information_schema.columns` on the live project agrees.
--
-- What was blocked without it: notification quiet hours (named in the founding
-- brief), a correct "today" boundary for anything date-bucketed, a correct
-- server-rendered greeting, and kickoff times shown in the user's own zone
-- rather than whatever zone the rendering server happens to sit in.
--
-- Nullable on purpose. There is no honest way to derive a timezone for the one
-- profile that already exists, and KIVO does not fabricate values: null means
-- "we have not been told", and every consumer is required to fall back to UTC
-- and say so rather than guess. The only source this column is ever written
-- from is the user themselves — onboarding and Settings, pre-filled from the
-- browser's own `Intl.DateTimeFormat().resolvedOptions().timeZone` and
-- confirmable/changeable by the user. Explicitly never IP geolocation.

alter table profiles
  add column if not exists timezone text;

comment on column profiles.timezone is
  'IANA timezone name (e.g. "Africa/Lagos") as stated by the user, never inferred from IP. Null means the user has not told us; consumers must fall back to UTC and label it, never guess.';

-- Cheap shape gate: rejects obvious junk (empty strings, whitespace, absurd
-- lengths, anything with characters no IANA zone name contains) without
-- needing to know the zone database. The real membership check is the trigger
-- below — this constraint exists so that even if the trigger were ever
-- dropped, the column cannot become a free-text field.
alter table profiles
  drop constraint if exists profiles_timezone_shape;

alter table profiles
  add constraint profiles_timezone_shape check (
    timezone is null or timezone ~ '^[A-Za-z][A-Za-z0-9+_-]*(/[A-Za-z0-9+_-]+){0,2}$'
  );

-- Real validation: the value must be a zone this Postgres server actually
-- knows, checked against pg_timezone_names. This cannot be a CHECK constraint
-- (check expressions may not contain subqueries), so it is a trigger — which
-- also lets it raise a message a human can read instead of a constraint code.
--
-- pg_timezone_names is ~1200 rows and this fires only on a profile insert or
-- an actual change to the column, so the scan cost is irrelevant here. The
-- `is distinct from` guard means the ordinary profile update path (username,
-- avatar, moderation status, ...) does not pay for it at all.
create or replace function private.validate_profile_timezone()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.timezone is not null
     and (tg_op = 'INSERT' or new.timezone is distinct from old.timezone)
     and not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone)
  then
    raise exception 'Unknown timezone %', new.timezone
      using errcode = '22023',
            hint = 'Use an IANA timezone name such as Africa/Lagos or Europe/London.';
  end if;
  return new;
end;
$$;

-- Nothing should be able to call this directly. `private` is not a
-- PostgREST-exposed schema, and 0001's blanket `grant execute on all
-- functions in schema private` was a one-time grant that does not cover
-- functions created later — this makes that explicit rather than incidental,
-- the same posture migration 0021 took for its trigger function. A trigger
-- fires regardless of the caller's EXECUTE privilege (Postgres checks that at
-- CREATE TRIGGER time, not at fire time), so this costs the trigger nothing.
revoke execute on function private.validate_profile_timezone() from public;

drop trigger if exists trg_profiles_validate_timezone on profiles;
create trigger trg_profiles_validate_timezone
  before insert or update of timezone on profiles
  for each row execute function private.validate_profile_timezone();

-- Verified live against the real project after applying: a real zone
-- ('Africa/Lagos') persists, a plausible-but-fake one ('Africa/Lagosss') is
-- refused with 22023, junk ('not a zone!!') is refused, and null is still
-- allowed. Worth knowing for anyone reading the two guards above: a BEFORE
-- trigger fires ahead of constraint evaluation, so badly-shaped input is
-- actually caught by the trigger's readable message rather than by the check
-- constraint — the constraint's job is to still be there if the trigger ever
-- is not.

-- No RLS change needed: `profiles_update_own` (rewritten in 0053) already
-- scopes an update to the caller's own row, and timezone is an ordinary
-- self-service field on that row — the same class as bio or country.

-- To reverse:
--   drop trigger if exists trg_profiles_validate_timezone on profiles;
--   drop function if exists private.validate_profile_timezone();
--   alter table profiles drop constraint if exists profiles_timezone_shape;
--   alter table profiles drop column if exists timezone;
