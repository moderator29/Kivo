import type { Database } from "@/lib/supabase/types";

type TransferType = Database["public"]["Enums"]["transfer_type"];

// Plain, honest labels only — API-Football's transfer data is real,
// already-completed moves and nothing else. There is no rumour/reported
// tier to draw from, so no "Confirmed / Rumour / Advanced Talks" taxonomy
// belongs here (that would need a news/journalist source KIVO doesn't
// have — see AGENTS.md). Was defined identically in `/transfers` and
// `players/[id]` before this consolidation; both, plus the new club ledger
// on `teams/[id]` (RECOMMENDATIONS.md item 164), now share this one map.
export const TRANSFER_TYPE_LABEL: Record<TransferType, string> = {
  transfer: "Transfer",
  loan: "Loan",
  free: "Free transfer",
  end_of_loan: "End of loan",
  unknown: "Fee undisclosed",
};
