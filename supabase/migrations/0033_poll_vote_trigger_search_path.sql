-- Fix-up for 0032 (same pattern as 0028's fix-up of 0018): get_advisors flagged
-- private.set_poll_vote_post_id() with "function_search_path_mutable" —
-- unlike set_updated_at() (which touches no table), this function queries
-- poll_options unqualified, so a mutable search_path really is exploitable
-- here (a role that could create an object named poll_options earlier in its
-- own search_path could shadow the real table). Pinning search_path closes
-- that off, same as every other function in this schema that touches a table.
create or replace function private.set_poll_vote_post_id()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  select post_id into new.post_id from poll_options where id = new.option_id;
  if new.post_id is null then
    raise exception 'poll option % does not exist', new.option_id;
  end if;
  return new;
end;
$$;

-- To reverse: recreate without the `set search_path` clause (not recommended).
