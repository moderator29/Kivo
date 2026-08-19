import { describe, expect, it } from "vitest";
import {
  BUDGETED_PROVIDER_IDS,
  PROVIDER_REQUEST_BUDGETS,
  REQUEST_BUDGET_WINDOW_SECONDS,
  TOTAL_AUTOMATED_REQUEST_BUDGET,
  describeBudgetRefusal,
  type BudgetRefusalReason,
} from "./request-budget";

describe("PROVIDER_REQUEST_BUDGETS mirror", () => {
  it("stays under a hundred-request free tier, leaving headroom no bucket can reach", () => {
    // The whole point of the split: whatever automation does, a human pressing
    // "Sync now" still has room, because automation is structurally unable to
    // reach the remainder.
    expect(TOTAL_AUTOMATED_REQUEST_BUDGET).toBeLessThan(100);
    expect(TOTAL_AUTOMATED_REQUEST_BUDGET).toBe(
      Object.values(PROVIDER_REQUEST_BUDGETS).reduce((a, b) => a + b, 0),
    );
  });

  it("uses a rolling 24 hours rather than a calendar day", () => {
    // KIVO cannot establish when any provider's own counter resets, and a
    // trailing cap of N implies at most N spends in ANY 24-hour interval.
    expect(REQUEST_BUDGET_WINDOW_SECONDS).toBe(86_400);
  });

  it("gives the daily baseline the smallest slice and the live worker the largest", () => {
    expect(PROVIDER_REQUEST_BUDGETS.daily).toBeLessThan(PROVIDER_REQUEST_BUDGETS.auto);
    expect(PROVIDER_REQUEST_BUDGETS.live).toBeGreaterThan(PROVIDER_REQUEST_BUDGETS.auto);
  });
});

describe("BUDGETED_PROVIDER_IDS", () => {
  it("names both new providers, because an id with no budget row is refused every request", () => {
    expect(BUDGETED_PROVIDER_IDS).toContain("bigballs");
    expect(BUDGETED_PROVIDER_IDS).toContain("football-data");
  });

  it("keeps the two existing providers, which have live mappings in the database", () => {
    expect(BUDGETED_PROVIDER_IDS).toContain("api-football");
    expect(BUDGETED_PROVIDER_IDS).toContain("thesportsdb");
  });
});

describe("describeBudgetRefusal", () => {
  it("distinguishes 'tomorrow' from 'in a moment'", () => {
    expect(describeBudgetRefusal("window_exhausted", "api-football", "live")).toMatch(/rolling 24 hours/i);
    expect(describeBudgetRefusal("burst_exhausted", "api-football", "live")).toMatch(/within the minute/i);
  });

  it("says plainly when a refusal is a code problem rather than a quota problem", () => {
    // The confusion this field exists to end: an adapter whose id has no budget
    // row looks exactly like an exhausted account.
    expect(describeBudgetRefusal("unknown_provider", "bigbals", "daily")).toMatch(/code problem/i);
    expect(describeBudgetRefusal("unknown_bucket", "api-football", "live")).toMatch(/code problem/i);
  });

  it("explains why an unreadable ledger refuses instead of failing open", () => {
    expect(describeBudgetRefusal("ledger_unreachable", "api-football", "daily")).toMatch(/same decision/i);
  });

  it("has a sentence for every refusal the database can return", () => {
    const reasons: BudgetRefusalReason[] = [
      "window_exhausted",
      "burst_exhausted",
      "unknown_bucket",
      "unknown_provider",
      "ledger_unreachable",
    ];
    for (const reason of reasons) {
      expect(describeBudgetRefusal(reason, "p", "live").length).toBeGreaterThan(20);
    }
    expect(describeBudgetRefusal(null, "p", "live")).toBe("Allowed.");
  });
});
