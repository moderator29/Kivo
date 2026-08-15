-- =============================================================================
-- KIVO: transfers table
-- =============================================================================
-- API-Football's free-tier /transfers?player={id} endpoint returns real,
-- recorded transfer history (player, date, from-club, to-club, raw fee string)
-- — historical fact, not market-value estimation. See AGENTS.md for why this
-- is safe to sync/display and why market value is not.
-- =============================================================================

-- Additive, safe: transfers get deduped through provider_mappings like every
-- other synced entity (competition/season/team/player/manager/venue/fixture/
-- fixture_event already use this enum — see supabase/migrations/0001).
alter type provider_entity_type add value 'transfer';

-- Inferred from the provider's raw fee_text at sync time (see
-- src/lib/football/sync-transfers.ts) — 'unknown' is used whenever the fee
-- text doesn't map cleanly, never guessed.
create type transfer_type as enum ('transfer', 'loan', 'free', 'end_of_loan', 'unknown');

create table transfers (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null references players (id) on delete cascade,
  -- Nullable: a transfer can originate/land outside KIVO's synced teams
  -- (e.g. a club KIVO has never seen a fixture for yet).
  from_team_id   uuid references teams (id) on delete set null,
  to_team_id     uuid references teams (id) on delete set null,
  transfer_date  date not null,
  -- Raw provider string ("€45M" / "Free" / "Loan" / "N/A") — different
  -- currencies/formats aren't worth a lossy parse into a number.
  fee_text       text,
  transfer_type  transfer_type not null default 'unknown',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger trg_transfers_updated_at before update on transfers
  for each row execute function set_updated_at();

create index idx_transfers_player_id on transfers (player_id);
create index idx_transfers_transfer_date on transfers (transfer_date desc);

-- Same public-read/admin-write RLS shape as the other football reference
-- tables (see the `foreach t in array [...]` block in 0001_kivo_core_schema.sql).
alter table transfers enable row level security;

create policy transfers_select_public on transfers
  for select to authenticated, anon using (true);

create policy transfers_insert_admin on transfers
  for insert to authenticated
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));

create policy transfers_update_admin on transfers
  for update to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']))
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));

create policy transfers_delete_admin on transfers
  for delete to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']));
