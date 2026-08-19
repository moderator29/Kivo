-- =============================================================================
-- Superseding a notification, without re-notifying when nothing changed
-- =============================================================================
-- 0104 gave `notifications` a `dedupe_key` and a unique index on
-- (profile_id, dedupe_key), and every producer resolved a conflict the obvious
-- way: `ON CONFLICT DO NOTHING`. For most types that is right. For one class of
-- type it is quietly, specifically wrong, and a seeded account proved it.
--
-- THE DEFECT THAT MOTIVATED THIS. A test account's bell held six fantasy
-- notifications where three belonged: gameweeks 3 and 4 had each notified
-- twice, 97 seconds apart. Gameweek 4 appeared with TWO DIFFERENT TOTALS — 28
-- and 36 — while `fantasy_points` held only 36, and every other surface in the
-- product (home tile, scorecard, share card) said 36 too. The 28 was a number
-- that existed nowhere else in KIVO, sitting in a notification a fan would read
-- as authoritative.
--
-- `DO NOTHING` would have made that worse rather than better. It keeps the
-- first write — the stale 28 — and discards the corrected 36. For a re-scored
-- gameweek the second write is not a duplicate. It is a correction, and the
-- newer value is the true one.
--
-- WHY THIS IS A FUNCTION AND NOT AN UPSERT. The resolution needed is
-- `DO UPDATE ... WHERE the payload actually changed`, and PostgREST's upsert
-- cannot express the WHERE. Without it, an ordinary re-sync would bump every
-- full-time notification back to the top of the bell and mark it unread again —
-- a re-notification carrying no new information, which is precisely the spam
-- the dedupe key exists to prevent. So the condition has to live in SQL, and a
-- function is the only place it can.
--
-- `created_at = now()` and `read_at = null` are deliberate and only fire on a
-- real change: a fan who read "you scored 28" needs to see the corrected 36,
-- and leaving it read hides the correction behind the thing it corrects.
--
-- WHICH TYPES USE THIS is not decided here. It is `NOTIFICATION_DEDUPE_MODE` in
-- src/lib/notification-registry.ts, beside the type's priority, title and icon
-- — the same reasoning that keeps priority out of the schema. A payload that is
-- COMPUTED can be recomputed to a better answer and wants this; a one-time
-- event that a re-run merely re-reads wants `DO NOTHING`.
--
-- SERVICE ROLE ONLY. Every producer that writes a notification for somebody
-- else already runs under the service-role client, because `notifications` has
-- no INSERT policy for a plain caller at all. This function must never become
-- reachable from the browser: it writes arbitrary rows into other people's
-- bells.

create or replace function public.upsert_notifications_superseding(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  insert into notifications (profile_id, type, payload, dedupe_key, quiet_until)
  select
    (row_data ->> 'profile_id')::uuid,
    row_data ->> 'type',
    coalesce(row_data -> 'payload', '{}'::jsonb),
    row_data ->> 'dedupe_key',
    nullif(row_data ->> 'quiet_until', '')::timestamptz
  from jsonb_array_elements(p_rows) as row_data
  on conflict (profile_id, dedupe_key) do update
    set payload     = excluded.payload,
        quiet_until = excluded.quiet_until,
        -- Only reached when the payload genuinely differs, so a notification
        -- never returns to the top of the bell to say the same thing again.
        created_at  = now(),
        read_at     = null
    where notifications.payload is distinct from excluded.payload;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.upsert_notifications_superseding(jsonb) from public;
revoke execute on function public.upsert_notifications_superseding(jsonb) from anon;
revoke execute on function public.upsert_notifications_superseding(jsonb) from authenticated;
grant execute on function public.upsert_notifications_superseding(jsonb) to service_role;

-- To reverse:
--   drop function if exists public.upsert_notifications_superseding(jsonb);
