-- =============================================================================
-- 0058 — Fix support_requests' handled-pair constraint (corrects 0055)
-- =============================================================================
--
-- WHAT WAS WRONG
-- --------------
-- 0055 shipped `support_requests_handled_pair`:
--
--   check ((handled_by is null and handled_at is null)
--       or (handled_by is not null and handled_at is not null))
--
-- while `handled_by` is `references profiles (id) on delete set null`. Those two
-- rules contradict each other. Deleting the profile of a support admin who had
-- ever triaged a request makes Postgres try to null `handled_by` on their rows,
-- which then violates the pair constraint — so the DELETE fails outright:
--
--   ERROR: new row for relation "support_requests" violates check constraint
--          "support_requests_handled_pair"
--   CONTEXT: SQL statement "UPDATE ONLY public.support_requests
--            SET handled_by = NULL WHERE $1 = handled_by"
--
-- In other words, a staff member who had ever touched the support queue could
-- not have their account removed. Found by running the RLS verification harness
-- against the real project as a real support_admin role (scripts/verify-rls.sql)
-- rather than by reading the DDL — the constraint and the foreign key are eight
-- lines apart and each looks correct on its own.
--
-- THE RIGHT RULE
-- --------------
-- What actually needs to be true is about the *request*, not about the person:
-- a request is either untouched (`open`, never handled) or it has been picked
-- up, and then we know WHEN. WHO is separate and genuinely optional, because a
-- handler's account can legitimately disappear afterwards. That is exactly what
-- `on delete set null` is for: the audit fact "this was handled, at this time"
-- survives; the attribution degrades to unknown.
--
-- (The full attribution is not lost either way — audit_log records
-- 'support_request_updated' with the actor at the time it happened.)
-- =============================================================================

alter table support_requests drop constraint if exists support_requests_handled_pair;

alter table support_requests
  add constraint support_requests_handled_pair
  check ((status = 'open') = (handled_at is null));

comment on column support_requests.handled_at is
  'When this request was first picked up. Null exactly while status is open — see support_requests_handled_pair.';
comment on column support_requests.handled_by is
  'Who picked it up, if their profile still exists. Nulled by on-delete-set-null when a staff account is removed; the handled_at fact and the audit_log entry both survive that.';

-- =============================================================================
-- To reverse
-- =============================================================================
-- Restore 0055's constraint — but note that doing so re-introduces the
-- undeletable-staff-account bug described above.
