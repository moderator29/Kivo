-- Fix-up for 0045 (same pattern as 0033's fix-up of 0032, 0028's fix-up of
-- 0018): get_advisors flagged two issues after 0045 landed.
--
-- 1. function_search_path_mutable on private.effective_moderation_status().
--    It touches no table (a pure CASE over its two scalar arguments), same
--    shape as set_updated_at() which the advisor leaves alone — but it does
--    reference the `moderation_status` enum by name, and pinning
--    search_path is cheap and matches every other function in this schema,
--    so just close the warning rather than argue with the linter.
-- 2. unindexed_foreign_keys on profiles_moderation_set_by_fkey — same class
--    of fix 0003 already applied to a batch of other FKs.
create or replace function private.effective_moderation_status(p_status moderation_status, p_expires_at timestamptz)
returns moderation_status
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when p_status = 'suspended' and p_expires_at is not null and p_expires_at <= now()
    then 'active'::moderation_status
    else p_status
  end;
$$;

create index if not exists idx_profiles_moderation_set_by on profiles (moderation_set_by);

-- To reverse: recreate private.effective_moderation_status without the `set
-- search_path` clause (not recommended); drop index
-- idx_profiles_moderation_set_by.
