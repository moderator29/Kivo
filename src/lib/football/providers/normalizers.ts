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

export interface RawFixtureStatEntry {
  type: string;
  value: number | string | null;
}

export interface NormalizedFixtureTeamStatValues {
  shotsTotal: number | null;
  shotsOnTarget: number | null;
  shotsOffTarget: number | null;
  shotsBlocked: number | null;
  shotsInsideBox: number | null;
  shotsOutsideBox: number | null;
  fouls: number | null;
  corners: number | null;
  offsides: number | null;
  possessionPct: number | null;
  yellowCards: number | null;
  redCards: number | null;
  saves: number | null;
  passesTotal: number | null;
  passesAccurate: number | null;
  passesPct: number | null;
  expectedGoals: number | null;
}

/**
 * Parses one raw API-Football stat value into a number: plain numbers pass through,
 * percentage strings ("56%") have their "%" stripped, and anything that isn't a
 * clean number (empty string, null, non-numeric text) becomes null. A null stat
 * means "not reported by the provider", never a fabricated 0 — same rationale as
 * fixture_statistics' nullable columns (see the migration's comment on expected_goals).
 */
function parseStatNumber(value: number | string | null): number | null {
  if (value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = value.trim().replace("%", "");
  if (cleaned.length === 0) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Maps API-Football's /fixtures/statistics `statistics` array — a flat list of
 * {type, value} pairs keyed by a human-readable English label, e.g.
 * {"type": "Ball Possession", "value": "56%"} — onto the fixed set of columns
 * fixture_statistics models. Matching is case-insensitive on `type` since
 * API-Football's exact casing isn't a documented guarantee. A `type` this doesn't
 * recognise is silently dropped rather than stored under an "unknown" bucket —
 * unlike fixture_status/fixture_event_type, fixture_statistics has no such bucket
 * because every column here is optional (see the migration's per-field comments on
 * only modelling fields the provider actually returns).
 */
export function mapFixtureStatistics(entries: RawFixtureStatEntry[]): NormalizedFixtureTeamStatValues {
  const byType = new Map<string, number | string | null>();
  for (const entry of entries) {
    byType.set(entry.type.trim().toLowerCase(), entry.value);
  }
  const get = (key: string): number | null => parseStatNumber(byType.has(key) ? byType.get(key)! : null);

  return {
    shotsTotal: get("total shots"),
    shotsOnTarget: get("shots on goal"),
    shotsOffTarget: get("shots off goal"),
    shotsBlocked: get("blocked shots"),
    shotsInsideBox: get("shots insidebox"),
    shotsOutsideBox: get("shots outsidebox"),
    fouls: get("fouls"),
    corners: get("corner kicks"),
    offsides: get("offsides"),
    possessionPct: get("ball possession"),
    yellowCards: get("yellow cards"),
    redCards: get("red cards"),
    saves: get("goalkeeper saves"),
    passesTotal: get("total passes"),
    passesAccurate: get("passes accurate"),
    passesPct: get("passes %"),
    expectedGoals: get("expected_goals"),
  };
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
