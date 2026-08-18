import { describe, expect, it } from "vitest";
import {
  FALLBACK_TIME_ZONE,
  dayKeyInTimeZone,
  isSupportedTimeZone,
  resolveTimeZone,
  startOfDayInTimeZone,
  timeZoneOffsetLabel,
} from "./timezone";

describe("isSupportedTimeZone", () => {
  it("accepts real IANA zones", () => {
    expect(isSupportedTimeZone("Africa/Lagos")).toBe(true);
    expect(isSupportedTimeZone("Europe/London")).toBe(true);
    expect(isSupportedTimeZone("UTC")).toBe(true);
  });

  it("rejects plausible-looking fakes without throwing", () => {
    expect(isSupportedTimeZone("Africa/Lagosss")).toBe(false);
    expect(isSupportedTimeZone("")).toBe(false);
    expect(isSupportedTimeZone("not a zone")).toBe(false);
  });
});

describe("resolveTimeZone", () => {
  it("uses a stated zone and says it was stated", () => {
    expect(resolveTimeZone("Africa/Lagos")).toEqual({ timeZone: "Africa/Lagos", isStated: true });
  });

  it("falls back to UTC — and admits it — for null, empty and unknown values", () => {
    for (const value of [null, undefined, "", "Mars/Olympus_Mons"]) {
      expect(resolveTimeZone(value)).toEqual({ timeZone: FALLBACK_TIME_ZONE, isStated: false });
    }
  });
});

describe("startOfDayInTimeZone", () => {
  it("is the zone's own midnight, not UTC midnight", () => {
    // 2026-08-18T23:30Z is already the 19th in Lagos (UTC+1).
    const instant = new Date("2026-08-18T23:30:00.000Z");
    expect(startOfDayInTimeZone("Africa/Lagos", instant).toISOString()).toBe("2026-08-18T23:00:00.000Z");
    expect(startOfDayInTimeZone("UTC", instant).toISOString()).toBe("2026-08-18T00:00:00.000Z");
  });

  it("is correct west of Greenwich, where UTC has already rolled over", () => {
    // 2026-08-19T02:00Z is still the 18th in New York (UTC-4 in August).
    const instant = new Date("2026-08-19T02:00:00.000Z");
    expect(startOfDayInTimeZone("America/New_York", instant).toISOString()).toBe("2026-08-18T04:00:00.000Z");
  });

  it("uses the offset in force at midnight, not the offset in force now (DST)", () => {
    // 2026-03-29 is the day the UK moves from GMT to BST at 01:00 local.
    // Midnight that day is still GMT (+0), even though by midday the zone is +1.
    const midday = new Date("2026-03-29T12:00:00.000Z");
    expect(startOfDayInTimeZone("Europe/London", midday).toISOString()).toBe("2026-03-29T00:00:00.000Z");
  });

  it("survives a sub-second instant without drifting", () => {
    const instant = new Date("2026-08-18T10:00:00.750Z");
    expect(startOfDayInTimeZone("Africa/Lagos", instant).toISOString()).toBe("2026-08-17T23:00:00.000Z");
  });
});

describe("dayKeyInTimeZone", () => {
  it("buckets a late kickoff on the day the viewer watched it", () => {
    const instant = new Date("2026-08-18T23:30:00.000Z");
    expect(dayKeyInTimeZone("Africa/Lagos", instant)).toBe("2026-08-19");
    expect(dayKeyInTimeZone("UTC", instant)).toBe("2026-08-18");
    expect(dayKeyInTimeZone("America/New_York", instant)).toBe("2026-08-18");
  });
});

describe("timeZoneOffsetLabel", () => {
  it("returns a real offset label for a real zone", () => {
    expect(timeZoneOffsetLabel("Africa/Lagos", new Date("2026-08-18T12:00:00.000Z"))).toBe("GMT+1");
  });

  it("returns null rather than guessing for an unknown zone", () => {
    expect(timeZoneOffsetLabel("Mars/Olympus_Mons")).toBeNull();
  });
});
