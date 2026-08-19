-- =============================================================================
-- 0085 — Two covering indexes 0083 missed
-- =============================================================================
-- `get_advisors` (performance), run immediately after 0083 as this branch's
-- standing rule requires, flagged `injuries.fixture_id` and `injuries.season_id`
-- as foreign keys with no covering index. 0083 shipped
-- `idx_injuries_competition_season` on (competition_id, season_id), which cannot
-- serve a season-only lookup because season_id is not its leading column — an
-- easy thing to believe you have covered and not have.
--
-- Both matter for a real query and for a real cascade:
--
--   * "who is out for this fixture" is the injuries lookup a Match Centre makes.
--   * deleting a season or a fixture makes Postgres scan `injuries` to apply
--     `on delete set null`, and an unindexed FK turns that into a sequential
--     scan of the whole table.
--
-- Split from 0083 rather than folded into it so the migration files on disk stay
-- a truthful record of what actually ran against the live project, in the order
-- it ran. 0083 is already applied; rewriting its file to look like it always had
-- these would make the history a reconstruction rather than a log.

create index if not exists idx_injuries_fixture on injuries (fixture_id);
create index if not exists idx_injuries_season on injuries (season_id);

-- To reverse:
--   drop index if exists idx_injuries_season;
--   drop index if exists idx_injuries_fixture;
