import { describe, expect, it } from "vitest";
import { describeQuietHours, parseClockTime, quietUntil, type QuietHoursWindow } from "@/lib/quiet-hours";

/**
 * Quiet hours decide whether a person gets interrupted, so the cases that
 * matter most are the ones where the answer must be "do not silence them":
 * no stated timezone, a window KIVO cannot parse, an ambiguous window. Every
 * one of those returns null, and every one of them is here.
 */

const LAGOS: QuietHoursWindow = {
  enabled: true,
  start: "22:00",
  end: "07:00",
  timeZone: "Africa/Lagos", // UTC+1, no DST — a clean fixture for wall-clock maths.
};

/** An instant that is `hh:mm` in Lagos on 2026-08-19. */
function lagos(hh: number, mm = 0): Date {
  return new Date(Date.UTC(2026, 7, 19, hh - 1, mm));
}

describe("parseClockTime", () => {
  it("reads both shapes Postgres `time` serialises to", () => {
    expect(parseClockTime("22:00")).toBe(22 * 60);
    expect(parseClockTime("07:30:00")).toBe(7 * 60 + 30);
  });

  it("refuses anything else rather than guessing", () => {
    expect(parseClockTime("25:00")).toBeNull();
    expect(parseClockTime("22:60")).toBeNull();
    expect(parseClockTime("10pm")).toBeNull();
    expect(parseClockTime("")).toBeNull();
  });
});

describe("quietUntil — inside a window that crosses midnight", () => {
  it("holds a notification produced late at night", () => {
    const until = quietUntil(LAGOS, lagos(23, 30));
    expect(until).not.toBeNull();
    // 23:30 -> 07:00 is 7h30m.
    expect(until!.getTime() - lagos(23, 30).getTime()).toBe(7.5 * 60 * 60_000);
  });

  it("holds one produced after midnight, still inside the window", () => {
    const until = quietUntil(LAGOS, lagos(2, 0));
    expect(until!.getTime() - lagos(2, 0).getTime()).toBe(5 * 60 * 60_000);
  });

  it("everything produced in one window surfaces at the same instant", () => {
    // This is the whole of KIVO's buildable "batching": same window, same
    // quiet_until, so a night of notifications appears together. 23:00 on the
    // 19th and 03:15 on the 20th are the same night — which is exactly the
    // case a same-calendar-day fixture would get wrong.
    const a = quietUntil(LAGOS, new Date(Date.UTC(2026, 7, 19, 22, 0)))!;
    const b = quietUntil(LAGOS, new Date(Date.UTC(2026, 7, 20, 2, 15)))!;
    expect(a.toISOString()).toBe(b.toISOString());
    expect(a.toISOString()).toBe("2026-08-20T06:00:00.000Z");
  });

  it("does not hold one produced outside it", () => {
    expect(quietUntil(LAGOS, lagos(7, 0))).toBeNull();
    expect(quietUntil(LAGOS, lagos(15, 0))).toBeNull();
    expect(quietUntil(LAGOS, lagos(21, 59))).toBeNull();
  });

  it("treats the start as inclusive and the end as exclusive", () => {
    expect(quietUntil(LAGOS, lagos(22, 0))).not.toBeNull();
    expect(quietUntil(LAGOS, lagos(6, 59))).not.toBeNull();
    expect(quietUntil(LAGOS, lagos(7, 0))).toBeNull();
  });
});

describe("quietUntil — a window inside one day", () => {
  const daytime: QuietHoursWindow = { ...LAGOS, start: "09:00", end: "17:00" };

  it("holds inside and delivers outside", () => {
    expect(quietUntil(daytime, lagos(12, 0))).not.toBeNull();
    expect(quietUntil(daytime, lagos(8, 59))).toBeNull();
    expect(quietUntil(daytime, lagos(17, 0))).toBeNull();
    expect(quietUntil(daytime, lagos(23, 0))).toBeNull();
  });
});

describe("quietUntil — every reason not to silence someone", () => {
  it("does nothing when quiet hours are off", () => {
    expect(quietUntil({ ...LAGOS, enabled: false }, lagos(23, 0))).toBeNull();
  });

  it("does nothing when the user has never stated a timezone", () => {
    // KIVO does not infer a zone from an IP, and applying UTC to a Lagos user
    // would hold their notifications back by the wrong hour.
    expect(quietUntil({ ...LAGOS, timeZone: null }, lagos(23, 0))).toBeNull();
  });

  it("does nothing for a zone this runtime cannot resolve", () => {
    expect(quietUntil({ ...LAGOS, timeZone: "Mars/Olympus_Mons" }, lagos(23, 0))).toBeNull();
  });

  it("does nothing for an unparseable window", () => {
    expect(quietUntil({ ...LAGOS, start: "not a time" }, lagos(23, 0))).toBeNull();
  });

  it("does nothing for a zero-length window, rather than picking a reading", () => {
    expect(quietUntil({ ...LAGOS, start: "22:00", end: "22:00" }, lagos(23, 0))).toBeNull();
  });
});

describe("quietUntil respects the zone, not the server", () => {
  it("gives opposite answers for two users at the same instant", () => {
    const instant = new Date("2026-08-19T23:30:00Z");
    // 00:30 in Lagos — inside 22:00-07:00.
    expect(quietUntil(LAGOS, instant)).not.toBeNull();
    // 16:30 in Los Angeles the same instant — wide awake.
    expect(quietUntil({ ...LAGOS, timeZone: "America/Los_Angeles" }, instant)).toBeNull();
  });
});

describe("describeQuietHours", () => {
  it("normalises whatever Postgres returned into one readable range", () => {
    expect(describeQuietHours({ ...LAGOS, start: "22:00:00", end: "7:00" })).toBe("22:00 to 07:00");
  });

  it("says nothing when quiet hours are off", () => {
    expect(describeQuietHours({ ...LAGOS, enabled: false })).toBeNull();
  });
});
