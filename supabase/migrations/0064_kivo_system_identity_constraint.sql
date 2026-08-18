-- =============================================================================
-- 0064 — Make kivo_system's unimpersonability a rule, not a coincidence
-- =============================================================================
-- KIVO_NEXT_GEN.md KN-128.
--
-- Migration 0047 created the `kivo_system` profile so Match Rooms could carry
-- system-authored goal and red-card posts (`posts.is_system`). 0053 noted that
-- its `auth_user_id` stays null.
--
-- That null is doing real security work today: every RLS policy resolves the
-- caller through `auth_user_id = auth.uid()`, and null never equals anything,
-- so no session can ever resolve to `kivo_system`. Nobody can sign in as the
-- account that authors posts the product presents as coming from KIVO itself.
--
-- But nothing enforces it. It holds because two separate migrations happened
-- not to fill the column in, and it would stop holding the moment someone
-- linked that row to an auth user — at which point whoever controls that
-- mailbox can post as KIVO, inside Match Rooms, with the system badge. There is
-- no code path that does this today; the point is that there is also nothing
-- stopping one.
--
-- The constraint is written as an equivalence rather than the one-directional
-- form KN-128 suggests (`auth_user_id is not null or username = 'kivo_system'`),
-- because the dangerous direction is the one that form leaves open:
--
--   * `kivo_system` must never GAIN an auth user   <- the impersonation risk
--   * every other profile must HAVE one            <- no orphan, unreachable rows
--
-- An equivalence states both in one expression. Verified against the live
-- project before applying: `kivo_system` (null, matching username) and the one
-- real account (linked, different username) both satisfy it.
--
-- Note on the username side of it: `profiles.username` is unique, so no other
-- account can take the name, and `kivo_system` cannot be renamed into a normal
-- account without a migration — a rename alone would violate this constraint,
-- since the row has no auth user to satisfy the other branch.
-- =============================================================================

alter table profiles
  add constraint profiles_auth_user_id_or_system
  check ((username = 'kivo_system') = (auth_user_id is null));

comment on constraint profiles_auth_user_id_or_system on profiles is
  'kivo_system (the system post author, migration 0047) is the one profile with no auth user, and it must stay that way: auth_user_id = auth.uid() can never match null, which is what makes it unimpersonable. Every other profile must have an auth user. Adding a second system account is a deliberate migration, not an accident.';

-- =============================================================================
-- To reverse
-- =============================================================================
-- alter table profiles drop constraint profiles_auth_user_id_or_system;
-- Doing so re-opens the possibility of linking kivo_system to a real mailbox,
-- which would let that mailbox's owner author is_system posts as KIVO.
