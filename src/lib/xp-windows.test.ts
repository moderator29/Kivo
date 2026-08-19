import { describe, expect, it } from "vitest";
import { summariseXpWindows, XP_WINDOW_LOOKBACK_DAYS } from "@/lib/xp-windows";

const NOW = Date.parse("2026-08-18T12:00:00.000Z");
const DAY = 86_400_000;

function entry(daysAgo: number, amount: number) {
  return { amount, createdAt: new Date(NOW - daysAgo * DAY).toISOString() };
}

/** Old enough that both windows always have a full predecessor. */
const LONG_STANDING = new Date(NOW - 400 * DAY).toISOString();

describe("summariseXpWindows", () => {
  it("sums only the rows inside each window", () => {
    const [week, month] = summariseXpWindows(
      [entry(1, 10), entry(6, 5), entry(9, 100), entry(40, 1000)],
      LONG_STANDING,
      NOW,
    );
    expect(week.earned).toBe(15);
    expect(month.earned).toBe(115);
  });

  it("puts the window before the window in `previous`, without double-counting", () => {
    const [week] = summariseXpWindows([entry(1, 10), entry(9, 7), entry(13, 3)], LONG_STANDING, NOW);
    expect(week.earned).toBe(10);
    expect(week.previous).toBe(10);
  });

  it("excludes rows older than the previous window", () => {
    const [week] = summariseXpWindows([entry(20, 999)], LONG_STANDING, NOW);
    expect(week.earned).toBe(0);
    expect(week.previous).toBe(0);
  });

  it("reports no previous window for an account younger than two windows", () => {
    const joined = new Date(NOW - 8 * DAY).toISOString();
    const [week, month] = summariseXpWindows([entry(1, 10)], joined, NOW);
    expect(week.previous).toBeNull();
    expect(month.previous).toBeNull();
  });

  it("reports a previous window once the account is exactly two windows old", () => {
    const joined = new Date(NOW - 14 * DAY).toISOString();
    const [week] = summariseXpWindows([entry(1, 10)], joined, NOW);
    expect(week.previous).toBe(0);
  });

  it("treats a window with no rows as a real zero", () => {
    const [week] = summariseXpWindows([], LONG_STANDING, NOW);
    expect(week.earned).toBe(0);
    expect(week.previous).toBe(0);
  });

  it("ignores an unparseable timestamp rather than counting it as now", () => {
    const [week] = summariseXpWindows(
      [{ amount: 50, createdAt: "not a date" }, entry(1, 10)],
      LONG_STANDING,
      NOW,
    );
    expect(week.earned).toBe(10);
  });

  it("looks back far enough to fill the longest window's predecessor", () => {
    expect(XP_WINDOW_LOOKBACK_DAYS).toBeGreaterThanOrEqual(60);
  });
});
