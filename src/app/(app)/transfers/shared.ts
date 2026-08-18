import type { Database } from "@/lib/supabase/types";
import { TRANSFER_TYPE_LABEL } from "@/lib/football/transfer-labels";

export type TransferType = Database["public"]["Enums"]["transfer_type"];

// Matches the exact `transfer_type` enum in supabase/migrations/0006_transfers.sql —
// the filter dropdown's option list has to stay a subset of real values, never a
// fabricated taxonomy of its own.
export const TRANSFER_TYPES = Object.keys(TRANSFER_TYPE_LABEL) as TransferType[];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type TeamRef = { id: string; name: string; short_name: string | null; crest_url: string | null };

export type TransferListItem = {
  id: string;
  transfer_date: string;
  fee_text: string | null;
  transfer_type: TransferType;
  player: { id: string; full_name: string; known_as: string | null } | null;
  from_team: TeamRef | null;
  to_team: TeamRef | null;
};

// The exact column/join list every transfers query needs — shared between
// the initial server-rendered page load and `loadMoreTransfers` so the two
// can never drift into fetching (or shaping) a different row shape.
export const TRANSFER_SELECT = `id, transfer_date, fee_text, transfer_type,
   player:players(id, full_name, known_as),
   from_team:teams!transfers_from_team_id_fkey(id, name, short_name, crest_url),
   to_team:teams!transfers_to_team_id_fkey(id, name, short_name, crest_url)`;

export type TransferFilterParams = { type?: string | null; club?: string | null; from?: string | null; to?: string | null };

export type TransferFilters = { type: TransferType | null; clubId: string | null; from: string | null; to: string | null };

/**
 * Never trust raw filter values directly in a `.or()`/`.eq()` filter string
 * without validating shape first — an allow-listed enum value, a real UUID,
 * a real date, or the filter is simply skipped. Shared between the initial
 * server-rendered page load and `loadMoreTransfers` so a "Load more" click
 * can never apply a subtly different filter than the page it's appending to.
 */
export function parseTransferFilters(raw: TransferFilterParams): TransferFilters {
  const type = raw.type && TRANSFER_TYPES.includes(raw.type as TransferType) ? (raw.type as TransferType) : null;
  const clubId = raw.club && UUID_RE.test(raw.club) ? raw.club : null;
  const from = raw.from && DATE_RE.test(raw.from) ? raw.from : null;
  const to = raw.to && DATE_RE.test(raw.to) ? raw.to : null;
  return { type, clubId, from, to };
}
