import { describe, expect, it } from "vitest";
import { calculateAge, formatDate, formatDateTime, formatNumber, timeAgo } from "./format";

/**
 * These tests exist to stop one specific regression: dropping back to an
 * implicit locale or an implicit time zone. Both are invisible in this
 * sandbox (Node defaults to en-US/UTC, so the output "looks right") and both
 * produce a hydration mismatch the moment a real visitor's browser disagrees
 * — see docs/BUG_AUDIT_2026-08-18.md C5 and the module doc in ./format.ts.
 *
 * They assert exact strings on purpose. If a format is deliberately changed,
 * these should be updated deliberately too.
 */
describe("formatDate", () => {
  it("uses the pinned en-GB long form", () => {
    expect(formatDate("2026-08-14")).toBe("14 August 2026");
  });

  it("uses the pinned en-GB short form", () => {
    expect(formatDate("2026-08-14", { month: "short" })).toBe("14 Aug 2026");
  });

  it("reads a date column in UTC, so the calendar date never shifts", () => {
    // A `date` column has no zone. Formatted with local getters west of
    // Greenwich this renders the 13th; that was a real bug on /transfers.
    expect(formatDate("2026-01-01", { month: "short" })).toBe("1 Jan 2026");
    expect(formatDate("2026-12-31", { month: "short" })).toBe("31 Dec 2026");
  });
});

describe("formatDateTime", () => {
  it("formats an instant in an explicitly named zone", () => {
    expect(formatDateTime("2026-08-14T19:30:00Z", "dayTime", "UTC")).toBe("14 Aug, 19:30");
    expect(formatDateTime("2026-08-14T19:30:00Z", "dayTime", "Africa/Lagos")).toBe("14 Aug, 20:30");
  });

  it("uses a 24-hour clock, not the American 12-hour default", () => {
    expect(formatDateTime("2026-08-14T19:30:00Z", "clock", "UTC")).toBe("19:30");
  });
});

describe("timeAgo", () => {
  const now = Date.parse("2026-08-14T12:00:00Z");
  const ago = (ms: number) => timeAgo(new Date(now - ms).toISOString(), now);

  it("labels the bands it documents", () => {
    expect(ago(30 * 1000)).toBe("just now");
    expect(ago(59 * 1000)).toBe("just now");
    expect(ago(60 * 1000)).toBe("1m");
    expect(ago(59 * 60 * 1000)).toBe("59m");
    expect(ago(60 * 60 * 1000)).toBe("1h");
    expect(ago(23 * 60 * 60 * 1000)).toBe("23h");
    expect(ago(24 * 60 * 60 * 1000)).toBe("1d");
    expect(ago(29 * 24 * 60 * 60 * 1000)).toBe("29d");
  });

  it("switches to a real date past 30 days, in the pinned locale", () => {
    expect(ago(31 * 24 * 60 * 60 * 1000)).toBe("14 Jul");
    expect(ago(400 * 24 * 60 * 60 * 1000)).toBe("10 Jul 2025");
  });

  it("takes its clock from the caller, so a component can keep it ticking", () => {
    const iso = new Date(now - 59 * 1000).toISOString();
    expect(timeAgo(iso, now)).toBe("just now");
    expect(timeAgo(iso, now + 2000)).toBe("1m");
  });
});

describe("calculateAge", () => {
  it("counts whole years", () => {
    const dob = new Date(Date.now() - 20 * 365.25 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(calculateAge(dob)).toBe(20);
  });
});

describe("formatNumber", () => {
  it("groups with commas rather than whatever the runtime prefers", () => {
    expect(formatNumber(12480)).toBe("12,480");
    expect(formatNumber(1234567)).toBe("1,234,567");
  });
});
