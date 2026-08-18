-- =============================================================================
-- 0055 — support_requests: the human escape hatch for a locked-out user
-- =============================================================================
--
-- WHY
-- ---
-- KIVO's only sign-in factor is a six-digit code emailed to one address
-- (migration 0053). There is no password, no social login and no recovery
-- factor. So a user whose email silently bounces, whose corporate spam filter
-- eats the message, or who typed one character wrong at sign-up is not
-- inconvenienced — they are gone, permanently, with no route to a human,
-- because the product has no contact surface at all (KIVO_NEXT_GEN.md KN-118).
--
-- This table is that route. /support writes here; /admin/support reads it.
--
-- WHY NOT EMAIL
-- -------------
-- Because KIVO has no transactional email of its own yet (RESEND_API_KEY is
-- reserved and unread — see ENVIRONMENT.md and KN-117), and a contact form that
-- silently drops messages would be worse than no contact form. A row in a table
-- an admin actually looks at is the honest version of this feature that can be
-- built today. docs/ACCOUNT_RECOVERY.md is the operator side of it.
--
-- WHY NO anon POLICY
-- ------------------
-- The whole point is that the person filing it CANNOT sign in, so the write has
-- to work without a session. Granting `anon` INSERT would make this the only
-- world-writable table in the schema and an obvious spam target. Instead this
-- table gets NO client-facing write policy at all — exactly the shape
-- rate_limit_events already uses (0013). Writes go through the service-role
-- client in src/app/support/actions.ts, behind checkRateLimit on both the
-- submitted address and the caller IP, so the throttle is enforced before a row
-- can exist. Reads are admin-only, below.
-- =============================================================================

create type support_request_topic as enum (
  'sign_in',        -- can't get a code / can't get in. The KN-118 case.
  'account',        -- username, deletion, data export, privacy
  'bug',
  'data_correction',-- "this scoreline/lineup is wrong"
  'other'
);

create type support_request_status as enum ('open', 'in_progress', 'closed');

create table support_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- The address to reply to. Deliberately free text and NOT a foreign key: the
  -- defining case for this table is somebody who has no account, or cannot
  -- prove which account is theirs.
  reply_email text not null,
  topic support_request_topic not null,
  message text not null,

  -- Set only when the reporter happened to be signed in while filing. Null is
  -- the normal case here, not a defect.
  profile_id uuid references profiles (id) on delete set null,

  status support_request_status not null default 'open',
  handled_by uuid references profiles (id) on delete set null,
  handled_at timestamptz,
  -- Admin-only working note. Never shown to the reporter (there is nowhere to
  -- show it to them — they have no account by construction).
  internal_note text,

  constraint support_requests_reply_email_shape check (reply_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  constraint support_requests_reply_email_length check (char_length(reply_email) between 5 and 254),
  constraint support_requests_message_length check (char_length(message) between 10 and 4000),
  constraint support_requests_internal_note_length check (internal_note is null or char_length(internal_note) <= 4000),
  -- A row is either untouched, or has both of the handling columns set.
  constraint support_requests_handled_pair check (
    (handled_by is null and handled_at is null) or (handled_by is not null and handled_at is not null)
  )
);

comment on table support_requests is
  'Inbound help requests from /support. The only route to a human for a user who cannot sign in (KIVO has no password and no social login). No client-facing INSERT policy by design — writes go through the service-role client behind a rate limit; see supabase/migrations for the full rationale.';
comment on column support_requests.reply_email is
  'Address to reply to, by hand, from outside KIVO. Not a foreign key: the defining case is someone with no account.';

-- The queue is read newest-first and filtered by status; both are covered here.
create index support_requests_status_created_at_idx on support_requests (status, created_at desc);

alter table support_requests enable row level security;

-- Read/triage: the support-facing admin roles only. Matches the role set
-- private.can_moderate() uses, minus 'moderator' (content moderation and
-- account support are different jobs) and plus nothing.
create policy support_requests_select_admin on support_requests
  for select to authenticated
  using (private.has_role(array['support_admin', 'admin', 'super_admin']));

create policy support_requests_update_admin on support_requests
  for update to authenticated
  using (private.has_role(array['support_admin', 'admin', 'super_admin']))
  with check (private.has_role(array['support_admin', 'admin', 'super_admin']));

-- Deliberately NO insert policy and NO delete policy. Inserts are service-role
-- only (see header). Deletes are nobody's — a support queue that can be emptied
-- by the people it holds accountable is not a support queue; closing a request
-- sets status, it does not remove the row.

-- Not belt-and-braces: verified against pg_default_acl on this project, the
-- `public` schema's default privileges grant arwdDxtm on every NEW table to
-- both `anon` and `authenticated` (the same mechanism that twice handed `anon`
-- EXECUTE on a new function — see 0025 and 0050, and KN-27). RLS above already
-- refuses every anon operation, but a table whose whole purpose is to be
-- written without a session should not also carry a table-level grant to the
-- sessionless role.
revoke all on table support_requests from anon;

-- =============================================================================
-- To reverse
-- =============================================================================
-- drop table support_requests;
-- drop type support_request_status;
-- drop type support_request_topic;
