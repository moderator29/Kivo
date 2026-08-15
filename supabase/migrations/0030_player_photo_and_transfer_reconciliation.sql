-- RECOMMENDATIONS.md item 56: getSquad() in src/lib/football/providers/api-football.ts
-- already fetches API-Football's `photo` field on every /players/squads call (paid for
-- in quota whether it's stored or not) but discarded it. Add the column it maps onto.
alter table players add column photo_url text;

comment on column players.photo_url is
  'Provider-supplied player photo URL (API-Football /players/squads "photo" field, real provider data). Null until a squad sync has run for this player''s team, or if the provider has none on file -- the UI falls back to a generic avatar, never a fabricated image.';

-- RECOMMENDATIONS.md item 64: resolveTeamId in src/lib/football/sync-transfers.ts
-- correctly leaves from_team_id/to_team_id null when a transfer references a club
-- KIVO hasn't synced yet, rather than guessing -- but the provider's own team id for
-- that unresolved side was never persisted anywhere, so a later reconciliation pass
-- (once the club *has* been synced) had no way to re-resolve it without spending
-- fresh provider quota re-fetching the player's whole transfer history. Persisting
-- the raw provider id alongside the null KIVO id makes that reconciliation a pure
-- provider_mappings lookup -- zero provider calls.
alter table transfers add column from_team_provider_id text;
alter table transfers add column to_team_provider_id text;

comment on column transfers.from_team_provider_id is
  'Provider''s raw team id for this transfer''s origin club, persisted even when from_team_id is null so an admin-triggered reconciliation pass can re-resolve it against provider_mappings later, at zero provider-quota cost, once that club has been synced.';
comment on column transfers.to_team_provider_id is
  'Same as from_team_provider_id, for this transfer''s destination club.';

-- Narrow partial indexes -- these only ever get scanned by the reconciliation pass
-- (`from_team_id is null and from_team_provider_id is not null`, mirrored for to_team),
-- never by any hot-path query, so there's no reason to index every transfers row.
create index idx_transfers_unresolved_from_team on transfers (from_team_provider_id)
  where from_team_id is null and from_team_provider_id is not null;
create index idx_transfers_unresolved_to_team on transfers (to_team_provider_id)
  where to_team_id is null and to_team_provider_id is not null;
