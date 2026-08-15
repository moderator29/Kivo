-- Every other extension in this project (pg_stat_statements, uuid-ossp, pgcrypto,
-- citext) lives in the dedicated `extensions` schema; pg_trgm landed in `public`
-- by default when added in migration 0021 (search indexes). Move it to match,
-- per the advisor's "Extension in Public" finding. Relocatable extension, so
-- this just reassigns the extension's own objects' schema; the GIN indexes
-- already built against gin_trgm_ops keep working (an index's operator class
-- is bound by OID at creation time, not resolved by schema/search_path on
-- every query).
alter extension pg_trgm set schema extensions;

-- To reverse: alter extension pg_trgm set schema public.
