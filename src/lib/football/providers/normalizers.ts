/**
 * Pure, provider-quirk-encoding normalizers used by the API-Football adapter
 * (providers/api-football.ts). Split into their own module — deliberately
 * without a "server-only" import — so they stay importable from unit tests
 * without dragging in api-football.ts's server-only fetch/env dependencies.
 * A regression in any of these silently corrupts stored data, so they're the
 * second-highest-value unit-test target in the codebase after
 * fantasy-rules.ts's validateRoster.
 */
import type { FixtureStatus, NormalizedMatchEventType, NormalizedTransferType } from "../types";

/**
 * Maps API-Football's fixture `status.short` code onto our fixture_status enum.
 * Codes that don't map cleanly return "unknown" — see FixtureStatus's doc comment.
 */
export function mapStatus(shortStatus: string): FixtureStatus {
  if (["1H", "2H", "ET", "P", "LIVE", "BT"].includes(shortStatus)) return "live";
  if (shortStatus === "HT") return "halftime";
  if (["FT", "AET", "PEN"].includes(shortStatus)) return "finished";
  if (shortStatus === "PST") return "postponed";
  if (shortStatus === "ABD") return "abandoned";
  if (["CANC", "AWD", "WO"].includes(shortStatus)) return "cancelled";
  if (shortStatus === "NS") return "scheduled";
  return "unknown";
}

/**
 * Maps API-Football's (type, detail) pair onto our fixture_event_type enum values.
 * Combinations that don't map cleanly return "unknown" — the sync layer skips those
 * rather than writing a fabricated/guessed enum value (see sync-match-details.ts).
 */
export function mapEventType(type: string, detail: string): NormalizedMatchEventType {
  const t = type.toLowerCase();
  const d = detail.toLowerCase();

  if (t === "goal") {
    if (d.includes("own")) return "own_goal";
    if (d.includes("missed")) return "penalty_missed";
    if (d.includes("penalty")) return "penalty_goal";
    return "goal";
  }
  if (t === "card") {
    if (d.includes("second yellow")) return "second_yellow_card";
    if (d.includes("yellow")) return "yellow_card";
    if (d.includes("red")) return "red_card";
    return "unknown";
  }
  if (t === "subst") return "substitution";
  if (t === "var") return "var_review";
  return "unknown";
}

/**
 * Infers our transfer_type enum from API-Football's free-text `type` field on a
 * transfer record (e.g. "€45M", "$20M", "Free", "Loan", "N/A"). Never a guess:
 * anything that doesn't clearly match one of the known buckets returns "unknown"
 * rather than being assumed to be a paid transfer (see sync-transfers.ts).
 */
export function mapTransferType(feeText: string | null): NormalizedTransferType {
  if (!feeText) return "unknown";
  const t = feeText.trim().toLowerCase();
  if (t.length === 0 || t === "n/a") return "unknown";
  if (t.includes("end of loan")) return "end_of_loan";
  if (t.includes("loan")) return "loan";
  if (t.includes("free")) return "free";
  // A fee-bearing move reports an amount ("€45M", "$20M", "45000000", ...) — any
  // digit is a reliable enough signal that this is a genuine paid transfer.
  if (/\d/.test(t)) return "transfer";
  return "unknown";
}
