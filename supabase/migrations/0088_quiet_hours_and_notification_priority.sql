-- =============================================================================
-- Quiet hours, and the honest shape of "priority" in a product with one channel
-- =============================================================================
-- The founding brief asks the notification system for quiet hours, priority
-- levels, timezone awareness and intelligent batching. `profiles.timezone`
-- (0054) unblocked the third. This migration is the first two, and it is
-- deliberately explicit about what the fourth can and cannot mean here.
--
-- WHAT QUIET HOURS CAN MEAN TODAY, AND WHAT IT CANNOT.
--
-- Every notification KIVO produces is in-app: a row that sits in a list until
-- the person opens the app. There is no push and no email (see BUILD_STATUS.md
-- — no service worker, no transactional sender). An in-app row is not
-- "delivered" at a moment, so quiet hours cannot stop it arriving. There is
-- nothing to stop.
--
-- Suppressing the row instead would be worse than doing nothing: a goal that
-- happened at 2am is still a goal the user wants to read at 8am, and deleting
-- it in the name of not disturbing them destroys information they asked for.
--
-- So quiet hours here defer the *interruption*, not the information. The row is
-- always written. What it does not do, until the window ends, is drive the
-- unread badge — the only thing in KIVO that currently interrupts anybody. The
-- notification is in the list the whole time for anyone who looks; it simply
-- stops tapping them on the shoulder.
--
-- That is also the only form of the brief's "intelligent batching" that is
-- buildable without a scheduler: everything produced during a quiet window
-- surfaces together when the window ends, because they all carry the same
-- `quiet_until`. Deferred *surfacing*, not deferred delivery. Real batching —
-- collecting several goals into one message — needs a job that wakes up and
-- writes a summary, and KIVO has one cron entry point, not a job queue. That
-- is stated here rather than half-built.
--
-- PRIORITY is deliberately NOT a column. A notification's priority is a
-- property of its *type*, and every type's priority is the same for every row
-- of that type forever — storing it would duplicate a fact that already has a
-- home, and invite two rows of one type to disagree. It lives in
-- `NOTIFICATION_PRIORITY` (src/lib/notification-registry.ts) beside the title,
-- icon and destination for the same type. What reaches the database is the
-- *consequence*: a high-priority notification is written with a null
-- `quiet_until`, which is what "breaks through quiet hours" actually means.

-- -----------------------------------------------------------------------------
-- The preference
-- -----------------------------------------------------------------------------
alter table notification_preferences
  add column if not exists quiet_hours_enabled boolean not null default false,
  -- `time` and not `timestamptz`: this is a wall-clock intention ("not after
  -- ten at night"), and it stays true across DST precisely because it carries
  -- no offset. The offset is supplied at evaluation time by the user's own
  -- `profiles.timezone`.
  add column if not exists quiet_hours_start time not null default '22:00',
  add column if not exists quiet_hours_end   time not null default '07:00';

comment on column notification_preferences.quiet_hours_enabled is
  'When true, low- and normal-priority notifications produced inside the window below do not drive the unread badge until the window ends. The rows are still written and still readable — quiet hours defer the interruption, never the information.';

comment on column notification_preferences.quiet_hours_start is
  'Local wall-clock start, interpreted in profiles.timezone. A window whose end is earlier than its start crosses midnight, which is the normal case.';

-- Off by default, and that is the honest default rather than a cautious one:
-- KIVO cannot guess when somebody sleeps, and a quiet window nobody asked for
-- would silently hold back notifications they were expecting.

-- -----------------------------------------------------------------------------
-- The consequence, on the notification itself
-- -----------------------------------------------------------------------------
-- Set at produce time to the instant the recipient's quiet window ends, and
-- null for everything else — which is every notification for every user who
-- has not turned quiet hours on, and every high-priority notification for
-- everyone.
--
-- Stamped at write time rather than evaluated at read time on purpose. The
-- question this answers is "was the person in their quiet hours when this
-- happened", and that is a fact about a moment that has passed; recomputing it
-- later against preferences that may since have changed would give a different
-- answer to the same question.
alter table notifications
  add column if not exists quiet_until timestamptz;

comment on column notifications.quiet_until is
  'The instant this notification stops being held back from the unread badge, or null when it was never held back. The row is always visible in the notification list regardless — this governs the badge only.';

-- The unread-badge query is `read_at is null and (quiet_until is null or
-- quiet_until <= now())`, per profile. A partial index on the unread rows
-- keeps it to the handful of rows that can actually match, rather than the
-- profile's whole history.
create index if not exists idx_notifications_unread_quiet
  on notifications (profile_id, quiet_until)
  where read_at is null;

-- To reverse:
--   drop index if exists idx_notifications_unread_quiet;
--   alter table notifications drop column if exists quiet_until;
--   alter table notification_preferences
--     drop column if exists quiet_hours_end,
--     drop column if exists quiet_hours_start,
--     drop column if exists quiet_hours_enabled;
