-- Item 24 (RECOMMENDATIONS.md): upsertVenue was writing a fabricated "Unknown
-- venue" placeholder string into a public table when the provider gave an id
-- but no name. venues.name no longer needs to be a lie to satisfy NOT NULL.
alter table venues alter column name drop not null;

-- Item 25: "unknown" previously only existed at the app's normalization layer
-- and got asserted into the DB as "postponed", a status the provider never
-- actually reported. Give it a real home in the enum instead.
alter type fixture_status add value if not exists 'unknown';

-- Item 26: lineups/events syncs were recorded under 'fixture_event' and
-- standings syncs under 'season' for lack of a better enum value, which
-- mislabels sync_runs history on the Data Health screen.
alter type provider_entity_type add value if not exists 'lineup';
alter type provider_entity_type add value if not exists 'standing';

-- To reverse: alter table venues alter column name set not null (only safe if
-- no null rows exist); enum values cannot be dropped without recreating the
-- type, so a rollback of the two ALTER TYPE statements would need a full
-- create-new-type-and-swap.
