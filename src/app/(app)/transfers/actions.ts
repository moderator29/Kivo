"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { TRANSFERS_PAGE_SIZE } from "./constants";
import { TRANSFER_SELECT, parseTransferFilters, type TransferFilterParams, type TransferListItem } from "./shared";
import { logError } from "@/lib/log";

/** Fetches one page of transfers starting at `offset`, applying the same
 * validated filters as the page's own initial query (audit item 2) —
 * requests `PAGE_SIZE + 1` rows via `.range` so `hasMore` can be read
 * directly off the response, same pattern as `loadMoreTeams`/`loadMoreLeagues`. */
export async function loadMoreTransfers(
  offset: number,
  filters: TransferFilterParams,
): Promise<{ error: string | null; transfers: TransferListItem[]; hasMore: boolean }> {
  const { type, clubId, from, to } = parseTransferFilters(filters);
  const supabase = createServerSupabaseClient();

  let request = supabase
    .from("transfers")
    .select(TRANSFER_SELECT)
    .order("transfer_date", { ascending: false });

  // Every filter applied server-side, before `.range()` — the exact bug
  // already found and fixed once in searchFantasyPlayers (filtering in JS
  // after the limit only ever searches whichever rows happened to land in
  // the first page).
  if (type) request = request.eq("transfer_type", type);
  if (clubId) request = request.or(`from_team_id.eq.${clubId},to_team_id.eq.${clubId}`);
  if (from) request = request.gte("transfer_date", from);
  if (to) request = request.lte("transfer_date", to);

  const { data, error } = await request.range(offset, offset + TRANSFERS_PAGE_SIZE);

  if (error) {
    logError("transfers.loadMore", error);
    return { error: "Couldn't load more transfers. Try again.", transfers: [], hasMore: false };
  }

  const rows = (data ?? []) as unknown as TransferListItem[];
  return {
    error: null,
    transfers: rows.slice(0, TRANSFERS_PAGE_SIZE),
    hasMore: rows.length > TRANSFERS_PAGE_SIZE,
  };
}
