-- KIVO_NEXT_GEN KN-108: let the AI Copilot answer from any synced entity, not
-- just the viewer's own follows.
--
-- WHY THIS IS A DATABASE FUNCTION AND NOT A LOOP IN TYPESCRIPT
-- ------------------------------------------------------------
-- The Copilot's grounding is built from the viewer's follows plus today's
-- fixtures. Ask about a real club KIVO has synced but you do not follow and the
-- honest-sounding answer is "KIVO doesn't have that" — which is false about
-- KIVO's own database. Fixing it means resolving the names in a message against
-- `teams`, `players` and `competitions` before the model runs.
--
-- Doing that from the app would be one `ilike` per candidate phrase per table:
-- a dozen phrases across three tables is dozens of round trips on the request
-- path of an endpoint that is rate-limited *because* it is already expensive.
-- Worse, an `ilike` needs a pattern built by string interpolation, which
-- `search-actions.ts` already avoids for a real injection reason it documents
-- at length.
--
-- One function taking `text[]` is both: a single round trip, and every phrase
-- travelling as a parameter rather than as filter syntax. The `%` operator is
-- pg_trgm's similarity match — the same extension backing the GIN indexes
-- migration 0021 created on exactly these columns (idx_teams_name_trgm,
-- idx_players_full_name_trgm, idx_players_known_as_trgm,
-- idx_competitions_name_trgm), so this reads the indexes rather than scanning.
-- pg_trgm lower-cases when it builds trigrams, so matching is case-insensitive
-- without a `lower()` wrapper that would defeat those indexes.
--
-- pg_trgm lives in the `extensions` schema (migration 0031 moved it there), so
-- `extensions` has to be on the search_path or `%` does not resolve.
--
-- SECURITY INVOKER, deliberately, like get_post_engagement (0060): these four
-- tables are readable by the caller anyway, this only changes where the
-- matching happens. A definer function would start returning rows a future RLS
-- change was meant to withhold, and would do it invisibly inside an AI feature —
-- the worst place for a quiet privilege escalation.
--
-- `p_min_similarity` is a real threshold, not decoration. Trigram matching will
-- happily return something for almost any input; a name that is only 20% similar
-- to a club is not a mention of that club, and feeding it to the model as a
-- fact KIVO holds would be exactly the fabrication this platform refuses. The
-- default of 0.4 is stricter than pg_trgm's own 0.3 default because the input
-- here is machine-generated word spans, not a human deliberately typing a
-- search box.

create or replace function public.resolve_football_entities(
  p_phrases        text[],
  p_limit          int  default 6,
  p_min_similarity real default 0.4
)
returns table (
  entity_type text,
  entity_id   uuid,
  label       text,
  sublabel    text,
  score       real
)
language sql
set search_path = public, extensions, pg_temp
stable
as $$
  with phrases as (
    select distinct lower(btrim(p)) as phrase
    from unnest(p_phrases) as p
    where length(btrim(p)) >= 3
  ),
  matched as (
    select
      'team'::text as entity_type,
      t.id         as entity_id,
      t.name       as label,
      t.country    as sublabel,
      max(similarity(t.name, ph.phrase)) as score
    from teams t
    join phrases ph on t.name % ph.phrase
    group by t.id, t.name, t.country

    union all

    select
      'player'::text,
      pl.id,
      coalesce(pl.known_as, pl.full_name),
      pl.position,
      max(greatest(similarity(pl.full_name, ph.phrase), similarity(coalesce(pl.known_as, ''), ph.phrase)))
    from players pl
    join phrases ph on (pl.full_name % ph.phrase or pl.known_as % ph.phrase)
    group by pl.id, pl.known_as, pl.full_name, pl.position

    union all

    select
      'competition'::text,
      c.id,
      c.name,
      c.country,
      max(similarity(c.name, ph.phrase))
    from competitions c
    join phrases ph on c.name % ph.phrase
    group by c.id, c.name, c.country
  )
  select entity_type, entity_id, label, sublabel, score
  from matched
  where score >= p_min_similarity
  order by score desc, label asc
  limit greatest(p_limit, 0);
$$;

revoke execute on function public.resolve_football_entities(text[], int, real) from public;
revoke execute on function public.resolve_football_entities(text[], int, real) from anon;
grant execute on function public.resolve_football_entities(text[], int, real) to authenticated;

-- To reverse: drop function public.resolve_football_entities(text[], int, real);
