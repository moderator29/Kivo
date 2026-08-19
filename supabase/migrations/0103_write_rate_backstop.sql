-- =============================================================================
-- F4 — a database ceiling under the application's rate limits
-- =============================================================================
-- docs/SECURITY_REVIEW.md, finding F4. `consume_rate_limit` (0066) is granted to
-- `service_role` only and `rate_limit_events` has RLS on with zero policies.
-- Both are right. The consequence is structural: rate limiting exists only in
-- the application layer, and every rate-limited table is directly writable
-- through PostgREST with the same publishable key the browser already holds.
-- `createPost` limits a user to five posts a minute; `posts_insert_own` does
-- not. A spam run needs a fetch loop, not an exploit.
--
-- -----------------------------------------------------------------------------
-- THIS IS A BACKSTOP. IT IS NOT THE PRODUCT LIMIT.
-- -----------------------------------------------------------------------------
-- Read that twice before touching a number in this file, because the single
-- most likely way to break KIVO with a well-meant edit is to "tidy" these
-- ceilings down until they agree with `checkRateLimit`.
--
-- They are deliberately several times looser than the application limits, and
-- the looseness is the entire design:
--
--   * A user who passes `checkRateLimit` can never trip these policies. Not
--     "rarely" — never, by an order of magnitude of headroom. So the two limits
--     can never disagree about a legitimate request, and no user ever sees a
--     database error the UI has no message for.
--   * The only way to reach these ceilings is to skip the server action
--     entirely, which is exactly the caller F4 is about.
--
-- It follows that **changing `checkRateLimit` does not require changing this
-- file.** Tighten the product limit, loosen it, add a burst allowance, move it
-- per-surface — none of that touches the ceiling, because the ceiling is not a
-- second opinion about what a reasonable user does. It is an absolute bound on
-- what any one account can do to the database in a minute.
--
-- The corollary is also true and worth stating: if you find yourself wanting to
-- raise a number here to unblock a real feature, the feature is writing tens of
-- rows per user per minute and that is the thing to look at first.
--
-- -----------------------------------------------------------------------------
-- Why RESTRICTIVE policies rather than rewriting the existing ones
-- -----------------------------------------------------------------------------
-- The security review's sketch rewrote `posts_insert_own` with the count folded
-- into its `WITH CHECK`. That works and it has two costs this avoids. Permissive
-- policies are OR-ed, so anyone adding a second permissive INSERT policy later
-- would silently reopen the hole; and `posts_insert_own` has now been rewritten
-- by three separate migrations (0045, 0047, 0095) for three unrelated reasons,
-- so folding a fourth concern into it makes the next rewrite riskier.
--
-- RESTRICTIVE policies are AND-ed with whatever the permissive set decides.
-- The ownership, moderation and system-post rules stay exactly where they are
-- and keep belonging to whoever owns them; this adds one orthogonal bound that
-- cannot be turned off by adding a policy.
--
-- -----------------------------------------------------------------------------
-- Why a SECURITY DEFINER counter rather than an inline subquery
-- -----------------------------------------------------------------------------
-- An inline `select count(*) from posts where author_profile_id = ...` inside a
-- policy is evaluated with RLS applied to that read, which means the count is
-- only as complete as `posts_select_public` happens to be. That policy is not
-- static — it already filters shadow-muted authors and blocked profiles, and it
-- will keep growing. A count that silently shrinks when an unrelated SELECT
-- policy changes is a backstop that silently stops backstopping.
--
-- These functions read as owner, so the count is exact regardless of what the
-- SELECT policy does next. They are safe to define that way because each one
-- can only ever count rows belonging to the caller — they take no arguments,
-- derive the profile from `private.current_profile_id()` (itself SECURITY
-- DEFINER, same as every other helper in this schema), and return a boolean.
-- There is no input to point them at somebody else.
--
-- Not exposed to PostgREST: `private` is not an exposed schema, and EXECUTE is
-- revoked from PUBLIC below. A policy fires regardless of the caller's EXECUTE
-- privilege, so that costs the policies nothing.

-- -----------------------------------------------------------------------------
-- Indexes first. A policy that runs a count on every insert must have one.
-- -----------------------------------------------------------------------------
-- Each table already has a bare (author) index and a bare (created_at) index,
-- neither of which serves "this author's rows in the last minute" well. The
-- composite is what makes each count an index-only range scan of a handful of
-- rows rather than a scan of one author's entire history.
create index if not exists idx_posts_author_created_at
  on posts (author_profile_id, created_at desc);

create index if not exists idx_comments_author_created_at
  on comments (author_profile_id, created_at desc);

create index if not exists idx_reactions_profile_created_at
  on reactions (profile_id, created_at desc);

create index if not exists idx_reports_reporter_created_at
  on reports (reporter_profile_id, created_at desc);

-- -----------------------------------------------------------------------------
-- The counters
-- -----------------------------------------------------------------------------
-- Each ceiling is stated next to the application limit it sits under, so the
-- headroom is visible rather than implied.

-- createPost / createPoll: 5 per 60s. Ceiling 60 per 60s — 12x.
create or replace function private.posts_within_write_ceiling()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*) < 60
  from posts
  where author_profile_id = private.current_profile_id()
    and created_at > now() - interval '1 minute';
$$;

-- createComment: 5 per 60s. Ceiling 60 per 60s — 12x.
create or replace function private.comments_within_write_ceiling()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*) < 60
  from comments
  where author_profile_id = private.current_profile_id()
    and created_at > now() - interval '1 minute';
$$;

-- setReaction: 30 per 60s. Ceiling 300 per 60s — 10x. Higher in absolute terms
-- than posts because reacting is genuinely a fast, repeated action and a reader
-- catching up on a busy Room legitimately fires a lot of them.
create or replace function private.reactions_within_write_ceiling()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*) < 300
  from reactions
  where profile_id = private.current_profile_id()
    and created_at > now() - interval '1 minute';
$$;

-- reportContent: 10 per 300s. Ceiling 100 per 300s — 10x. The window matches
-- the action's own five-minute window rather than being normalised to a minute,
-- because reporting is bursty by nature: someone working through a bad thread
-- files several in a row and then nothing for an hour.
create or replace function private.reports_within_write_ceiling()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*) < 100
  from reports
  where reporter_profile_id = private.current_profile_id()
    and created_at > now() - interval '5 minutes';
$$;

revoke execute on function private.posts_within_write_ceiling() from public;
revoke execute on function private.comments_within_write_ceiling() from public;
revoke execute on function private.reactions_within_write_ceiling() from public;
revoke execute on function private.reports_within_write_ceiling() from public;

-- -----------------------------------------------------------------------------
-- The policies
-- -----------------------------------------------------------------------------
-- `to authenticated` only. `service_role` bypasses RLS entirely, so the KIVO
-- system account's match-room posts (0047) and every server-side backfill are
-- unaffected by design — those are not the caller F4 describes.
drop policy if exists posts_insert_write_ceiling on posts;
create policy posts_insert_write_ceiling on posts
  as restrictive
  for insert to authenticated
  with check (private.posts_within_write_ceiling());

drop policy if exists comments_insert_write_ceiling on comments;
create policy comments_insert_write_ceiling on comments
  as restrictive
  for insert to authenticated
  with check (private.comments_within_write_ceiling());

drop policy if exists reactions_insert_write_ceiling on reactions;
create policy reactions_insert_write_ceiling on reactions
  as restrictive
  for insert to authenticated
  with check (private.reactions_within_write_ceiling());

drop policy if exists reports_insert_write_ceiling on reports;
create policy reports_insert_write_ceiling on reports
  as restrictive
  for insert to authenticated
  with check (private.reports_within_write_ceiling());

comment on policy posts_insert_write_ceiling on posts is
  'F4 backstop, not the product limit. checkRateLimit allows 5/min; this allows 60/min and exists only so that skipping the server action does not also skip every limit. Changing checkRateLimit does not require changing this.';

comment on policy comments_insert_write_ceiling on comments is
  'F4 backstop, not the product limit. checkRateLimit allows 5/min; this allows 60/min.';

comment on policy reactions_insert_write_ceiling on reactions is
  'F4 backstop, not the product limit. checkRateLimit allows 30/min; this allows 300/min.';

comment on policy reports_insert_write_ceiling on reports is
  'F4 backstop, not the product limit. checkRateLimit allows 10 per 5 minutes; this allows 100 per 5 minutes.';

-- To reverse:
--   drop policy if exists reports_insert_write_ceiling on reports;
--   drop policy if exists reactions_insert_write_ceiling on reactions;
--   drop policy if exists comments_insert_write_ceiling on comments;
--   drop policy if exists posts_insert_write_ceiling on posts;
--   drop function if exists private.reports_within_write_ceiling();
--   drop function if exists private.reactions_within_write_ceiling();
--   drop function if exists private.comments_within_write_ceiling();
--   drop function if exists private.posts_within_write_ceiling();
--   drop index if exists idx_reports_reporter_created_at;
--   drop index if exists idx_reactions_profile_created_at;
--   drop index if exists idx_comments_author_created_at;
--   drop index if exists idx_posts_author_created_at;
