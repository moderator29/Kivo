import { describe, expect, it } from "vitest";
import { addDays, dateKey, todayIn } from "./date-strip";

/**
 * KN-32. These helpers used to be UTC-only, and the whole app agreed with
 * itself about that, which is what made the bug invisible: `dateKey` did
 * `toISOString().slice(0, 10)`, `addDays` stepped `setUTCDate`, and `todayUtc`
 * floored to UTC midnight. For the stated launch market (Nigeria, UTC+1) that
 * puts a 00:30 kickoff on the previous day; further from UTC the mismatch is
 * hours wide.
 *
 * The two properties worth pinning are the ones a fixed 24-hour step gets
 * wrong: the key must be the calendar day in the *viewer's* zone, and stepping
 * a day must step a calendar day, not 86,400,000 milliseconds — across a DST
 * transition those are different numbers, and a fixed step either repeats a day
 * or skips one.
 */
const LAGOS = "Africa/Lagos"; // UTC+1 year-round, no DST — the launch market
const LONDON = "Europe/London"; // BST/GMT, so the DST cases are real
const AUCKLAND = "Pacific/Auckland"; // UTC+12/+13, the far end of the range

describe("dateKey", () => {
  it("puts a 23:30 UTC instant on the NEXT day for a viewer an hour ahead", () => {
    const instant = new Date("2026-08-18T23:30:00.000Z");
    expect(dateKey(instant, "UTC")).toBe("2026-08-18");
    expect(dateKey(instant, LAGOS)).toBe("2026-08-19");
  });

  it("puts an early-morning local kickoff on the day the viewer calls it", () => {
    // 00:30 in Lagos on the 19th is 23:30 UTC on the 18th — the exact case the
    // item names, and the reason a Nigerian fan's late match used to vanish.
    const instant = new Date("2026-08-18T23:30:00.000Z");
    expect(dateKey(instant, LAGOS)).toBe("2026-08-19");
  });

  it("handles the far end of the offset range", () => {
    const instant = new Date("2026-08-18T13:00:00.000Z");
    expect(dateKey(instant, AUCKLAND)).toBe("2026-08-19");
    expect(dateKey(instant, "America/Los_Angeles")).toBe("2026-08-18");
  });
});

describe("todayIn", () => {
  it("returns an instant that maps back to the same calendar day in that zone", () => {
    for (const zone of ["UTC", LAGOS, LONDON, AUCKLAND]) {
      const start = todayIn(zone);
      expect(dateKey(start, zone)).toBe(dateKey(new Date(), zone));
    }
  });
});

describe("addDays", () => {
  it("steps forwards and backwards by whole calendar days", () => {
    const start = new Date("2026-08-18T00:00:00.000Z");
    expect(dateKey(addDays(start, 1, "UTC"), "UTC")).toBe("2026-08-19");
    expect(dateKey(addDays(start, -1, "UTC"), "UTC")).toBe("2026-08-17");
    expect(dateKey(addDays(start, 3, "UTC"), "UTC")).toBe("2026-08-21");
  });

  // The DST cases. A fixed +24h step across the spring-forward boundary lands
  // an hour short of local midnight and repeats the day; across autumn it lands
  // an hour past and can skip one.
  it("steps a whole day across the spring-forward transition", () => {
    // BST starts 2026-03-29 in London.
    const before = todayInZoneOn("2026-03-28T12:00:00.000Z", LONDON);
    expect(dateKey(addDays(before, 1, LONDON), LONDON)).toBe("2026-03-29");
    const on = todayInZoneOn("2026-03-29T12:00:00.000Z", LONDON);
    expect(dateKey(addDays(on, 1, LONDON), LONDON)).toBe("2026-03-30");
  });

  it("steps a whole day across the autumn transition", () => {
    // BST ends 2026-10-25 in London.
    const before = todayInZoneOn("2026-10-24T12:00:00.000Z", LONDON);
    expect(dateKey(addDays(before, 1, LONDON), LONDON)).toBe("2026-10-25");
    const on = todayInZoneOn("2026-10-25T12:00:00.000Z", LONDON);
    expect(dateKey(addDays(on, 1, LONDON), LONDON)).toBe("2026-10-26");
  });

  // The two preconditions the first implementation quietly got wrong. Both are
  // regression tests for a real bug, not hypotheticals: the nudge that keeps a
  // step clear of a DST boundary was signed with `days`, which subtracted 36
  // hours in total for a backwards step and landed a day early; and the
  // function assumed its input was already local midnight, so any caller
  // handing it an arbitrary instant got an answer that was a day out.
  it("steps backwards by more than one day without drifting", () => {
    const start = todayInZoneOn("2026-08-18T12:00:00.000Z", LAGOS);
    expect(dateKey(addDays(start, -1, LAGOS), LAGOS)).toBe("2026-08-17");
    expect(dateKey(addDays(start, -2, LAGOS), LAGOS)).toBe("2026-08-16");
    expect(dateKey(addDays(start, -7, LAGOS), LAGOS)).toBe("2026-08-11");
  });

  it("accepts any instant, not only a local midnight", () => {
    // Same calendar day in Lagos, three very different instants within it.
    for (const iso of ["2026-08-18T00:00:00.000Z", "2026-08-18T11:59:00.000Z", "2026-08-18T22:59:00.000Z"]) {
      expect(dateKey(addDays(new Date(iso), 1, LAGOS), LAGOS)).toBe("2026-08-19");
    }
  });

  it("is its own inverse: stepping out and back returns the same day", () => {
    const start = todayInZoneOn("2026-10-25T12:00:00.000Z", LONDON);
    for (const n of [1, 2, 5, -1, -3]) {
      expect(dateKey(addDays(addDays(start, n, LONDON), -n, LONDON), LONDON)).toBe(dateKey(start, LONDON));
    }
  });

  it("produces a strip of seven consecutive, distinct days", () => {
    const selected = todayInZoneOn("2026-10-25T12:00:00.000Z", LONDON);
    const keys = Array.from({ length: 7 }, (_, i) => dateKey(addDays(selected, i - 3, LONDON), LONDON));
    expect(new Set(keys).size).toBe(7);
    expect(keys).toEqual([...keys].sort());
  });
});

/** Local midnight of the calendar day the given instant falls on, in `zone`. */
function todayInZoneOn(iso: string, zone: string): Date {
  return addDays(new Date(iso), 0, zone);
}
