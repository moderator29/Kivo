-- =============================================================================
-- 0108 — A club picker that survives a database with thousands of clubs
-- =============================================================================
-- THE DEFECT THIS FIXES
-- ---------------------
-- "Choose the club you support" opened with `select * from teams order by name
-- limit 40` and searched with `name ilike '%q%'`. On the live database that is
-- 705 clubs of which the first forty alphabetically are reserve sides, youth
-- teams and fourth divisions — so the first thing a new user sees is a list
-- with nothing they support in it, and no way to tell whether their club is
-- missing or merely two hundred rows down.
--
-- Two halves to the fix. The pipeline half — why the database holds "SGV
-- Freiberg Fussball U19" and not Real Madrid — is migration 0107 and the
-- catalogue sync beside it. This is the other half: given whatever clubs exist,
-- find the right one fast, and open on something better than the alphabet.
--
-- WHAT "BETTER THAN THE ALPHABET" IS ALLOWED TO MEAN
-- -------------------------------------------------
-- KIVO has no popularity data and must not invent any. There is no club-size
-- table, no market values, no "big six" list, and adding one by hand would be
-- an editorial opinion wearing a database's clothes — a reader could not tell
-- it from a measurement, which is precisely what makes it dishonest.
--
-- So the ordering here uses exactly one signal, and it is a real count of a
-- real thing KIVO's own users did:
--
--   1. how many KIVO profiles follow this club (`follows`), descending;
--   2. then the club's name, ascending.
--
-- Nothing else. `standings` and `players` are empty on the live database, so a
-- "synced depth" tier would today be a tiebreaker that never breaks a tie while
-- reading, to anyone auditing this, as though it did. It can be added the day
-- it means something.
--
-- The follower count starts at zero for every club, and that is not a flaw in
-- the signal — it is the signal being honest about a young product. On day one
-- this function returns clubs in alphabetical order, which is exactly what the
-- brief calls for when no real ordering exists, and it starts ranking the
-- moment real people start following clubs. No stage of that is a guess.
--
-- WHY A FUNCTION RATHER THAN A QUERY FROM THE CLIENT
-- --------------------------------------------------
-- `follows_select_own` (migration 0001) restricts a plain select on `follows`
-- to the caller's own rows, so a "how many people follow this club" ordering
-- cannot be expressed from the client at all. Same reasoning, and the same
-- narrow shape, as `get_most_followed_teams` (0040) and
-- `get_prediction_consensus` (0032): the aggregate is exposed, never who
-- follows whom.
--
-- WHERE "IN THIS COMPETITION" COMES FROM
-- --------------------------------------
-- `competition_teams` (0107) is the primary source: the provider's own list of
-- which clubs are in a competition in a season, which does not need a match to
-- have been played. Fixtures are unioned in as a second real source — see the
-- CTE below for why that is a definition rather than a fallback.
--
-- WHY THE AGGREGATE CANNOT BE COMPUTED OVER EVERY CLUB
-- ---------------------------------------------------
-- Counting followers for all 705 clubs is free; counting them for fifty
-- thousand on every keystroke is not. So the ranking is split rather than
-- computed wholesale: the followed set is derived FROM `follows` (bounded by
-- the number of clubs anyone has ever followed, which is small by
-- construction and served by `idx_follows_target`), and every other club is
-- appended in name order behind it. Neither half scans an aggregate over the
-- whole `teams` table, at any size.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- search_clubs_ranked — the picker's only read
-- -----------------------------------------------------------------------------
-- Every argument is optional and null means "do not narrow by this", so one
-- function serves the opening list, a typed search, a competition filter and a
-- country filter, in one round trip each.
create or replace function public.search_clubs_ranked(
  p_query          text default null,
  p_competition_id uuid default null,
  p_country        text default null,
  p_limit          int  default 40
)
returns table (
  id             uuid,
  name           text,
  short_name     text,
  crest_url      text,
  country        text,
  follower_count bigint
)
language sql
security definer
-- `extensions` is on the path for pg_trgm's operators, which is what makes the
-- `ilike '%…%'` below index-served rather than a sequential scan (0021 created
-- idx_teams_name_trgm; 0030 moved pg_trgm into `extensions`).
set search_path = public, extensions, pg_temp
stable
as $$
  with limits as (
    -- A caller-supplied ceiling is not a ceiling. 100 is the most this will
    -- ever return regardless of what is asked for, and 1 the least.
    select least(greatest(coalesce(p_limit, 40), 1), 100) as row_limit
  ),
  needle as (
    -- `%` and `_` typed by a person are literal characters, not wildcards.
    -- Escaped here rather than trusted from the caller, because a function
    -- that is only safe when its caller remembers something is not safe.
    select case
      when nullif(btrim(coalesce(p_query, '')), '') is null then null
      else '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
    end as pattern
  ),
  competition_clubs as (
    -- Which clubs count as "in" a competition.
    --
    -- `competition_teams` (migration 0107) first and by design: it is the
    -- provider's own answer to "who is in this league this season", and it
    -- does not require a match to have been played. That distinction is the
    -- whole reason the founder could not find Real Madrid — a fixtures-derived
    -- membership query cannot see a club that has not played a synced fixture.
    --
    -- Fixtures are unioned in rather than dropped, and this is a deliberate
    -- second source rather than a fallback that never fires. Two reasons, both
    -- real:
    --
    --   1. The catalogue backfill is quota-bounded (0107 budgets it at twelve
    --      provider requests a day), so `competition_teams` fills in one
    --      competition at a time over days. It is empty on the live database
    --      as this ships. A membership query reading it alone would offer a
    --      competition filter that narrows every competition to nothing —
    --      worse than the fixtures-derived one it replaced.
    --   2. A club that PLAYED a match in a competition is in that competition.
    --      That is evidence, not a guess, and it stays true for a competition
    --      the catalogue sync has not reached, for a season the provider
    --      declines to list, and for any competition covered by fixtures alone.
    --
    -- Neither source invents anything, so the union is the complete set of
    -- clubs KIVO has evidence for — which is the honest definition of the set,
    -- not a compromise between two.
    select ct.team_id from competition_teams ct where ct.competition_id = p_competition_id
    union
    select f.home_team_id as team_id from fixtures f where f.competition_id = p_competition_id
    union
    select f.away_team_id as team_id from fixtures f where f.competition_id = p_competition_id
  ),
  matching as (
    select t.id, t.name, t.short_name, t.crest_url, t.country
    from teams t, needle n
    where (
        n.pattern is null
        or t.name ilike n.pattern escape '\'
        or coalesce(t.short_name, '') ilike n.pattern escape '\'
      )
      and (p_country is null or t.country = p_country)
      and (p_competition_id is null or t.id in (select team_id from competition_clubs))
  ),
  followed as (
    -- Only clubs somebody actually follows reach this branch, so the aggregate
    -- is over `follows` (small, indexed by target) rather than over `teams`.
    select m.*, count(fl.id)::bigint as follower_count
    from matching m
    join follows fl on fl.followed_type = 'team' and fl.followed_id = m.id
    group by m.id, m.name, m.short_name, m.crest_url, m.country
  ),
  ranked as (
    select f.id, f.name, f.short_name, f.crest_url, f.country, f.follower_count,
           0 as tier
    from followed f
    union all
    select m.id, m.name, m.short_name, m.crest_url, m.country, 0::bigint as follower_count,
           1 as tier
    from matching m
    where not exists (select 1 from followed f where f.id = m.id)
  )
  select r.id, r.name, r.short_name, r.crest_url, r.country, r.follower_count
  from ranked r, limits
  -- `name` last and always, so the order is total: two clubs with the same
  -- follower count never swap places between two identical requests.
  order by r.tier, r.follower_count desc, r.name asc
  limit (select row_limit from limits);
$$;

comment on function public.search_clubs_ranked(text, uuid, text, int) is
  'Clubs for the "club you support" picker: optional name/short-name search, optional competition and country narrowing, ordered by how many KIVO profiles follow the club and then alphabetically. The follower count is the only ordering signal and it is a real count — KIVO holds no popularity data and this function invents none. SECURITY DEFINER because follows_select_own hides other profiles'' follows; only the aggregate count is exposed, never who follows whom.';

revoke execute on function public.search_clubs_ranked(text, uuid, text, int) from public, anon;
grant execute on function public.search_clubs_ranked(text, uuid, text, int) to authenticated;


-- -----------------------------------------------------------------------------
-- club_picker_facets — what there is to narrow by, counted for real
-- -----------------------------------------------------------------------------
-- The picker must not offer a filter that would empty the list, and it must not
-- offer a country facet at all while `teams.country` is null on every row —
-- which it is today. Both are the same rule: a control is offered when the data
-- behind it exists, and is absent otherwise. So this returns the real options
-- with their real club counts, and an empty result is a complete answer.
create or replace function public.club_picker_facets()
returns table (
  facet      text,
  key        text,
  label      text,
  club_count bigint
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with competition_clubs as (
    -- Same union, same reasoning, as search_clubs_ranked's own CTE: the
    -- provider's league membership (0107) plus every club that has actually
    -- played a fixture in the competition. The counts below are therefore
    -- "clubs KIVO has evidence for in this competition", which is a fact it
    -- can stand behind, rather than "clubs in this competition", which it
    -- cannot.
    select ct.competition_id, ct.team_id from competition_teams ct
    union
    select f.competition_id, f.home_team_id as team_id from fixtures f
    union
    select f.competition_id, f.away_team_id as team_id from fixtures f
  )
  select 'competition' as facet,
         c.id::text as key,
         c.name as label,
         count(distinct cc.team_id)::bigint as club_count
  from competition_clubs cc
  join competitions c on c.id = cc.competition_id
  group by c.id, c.name
  union all
  select 'country' as facet,
         t.country as key,
         t.country as label,
         count(*)::bigint as club_count
  from teams t
  where t.country is not null
  group by t.country
$$;

comment on function public.club_picker_facets() is
  'The competitions and countries the club picker can actually narrow by, with a real count of clubs behind each. A facet with no rows is not rendered as an empty control — teams.country is null on every synced row today, so the country facet legitimately returns nothing.';

revoke execute on function public.club_picker_facets() from public, anon;
grant execute on function public.club_picker_facets() to authenticated;


-- To reverse:
--   drop function if exists public.club_picker_facets();
--   drop function if exists public.search_clubs_ranked(text, uuid, text, int);
