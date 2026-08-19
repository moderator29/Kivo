import { afterEach, describe, expect, it, vi } from "vitest";
import {
  currentProviderSeason,
  describeTargetSeason,
  parseTargetSeasonEnv,
  resolveTargetSeason,
  resolveTargetSeasonWithoutDatabase,
  TARGET_SEASON_ENV,
} from "./target-season";

vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

const ORIGINAL = process.env[TARGET_SEASON_ENV];

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env[TARGET_SEASON_ENV];
  else process.env[TARGET_SEASON_ENV] = ORIGINAL;
});

/** The one row `resolveTargetSeason` reads, or an error, with no database. */
function fakeSupabase(result: { data: unknown; error: unknown }) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => result,
        }),
      }),
    }),
  } as never;
}

describe("currentProviderSeason", () => {
  it("returns the calendar year from July onward — the 2026/27 season is 2026", () => {
    expect(currentProviderSeason(new Date("2026-08-19T12:00:00Z"))).toBe(2026);
    expect(currentProviderSeason(new Date("2026-07-01T00:00:00Z"))).toBe(2026);
  });

  it("returns last year before July — January 2026 is still the 2025/26 season", () => {
    expect(currentProviderSeason(new Date("2026-01-15T12:00:00Z"))).toBe(2025);
    expect(currentProviderSeason(new Date("2026-06-30T23:59:59Z"))).toBe(2025);
  });
});

describe("parseTargetSeasonEnv", () => {
  it("accepts a four-digit year", () => {
    expect(parseTargetSeasonEnv("2024")).toBe(2024);
    expect(parseTargetSeasonEnv("  2024  ")).toBe(2024);
  });

  it("treats unset and empty as not set rather than as a year", () => {
    expect(parseTargetSeasonEnv(undefined)).toBeNull();
    expect(parseTargetSeasonEnv("")).toBeNull();
    expect(parseTargetSeasonEnv("   ")).toBeNull();
  });

  it("rejects anything that is not a bare four-digit year instead of coercing it", () => {
    // Number("") is 0 and Number("2024-25") is NaN. Both would become a season
    // the provider silently returns nothing for.
    expect(parseTargetSeasonEnv("2024-25")).toBeNull();
    expect(parseTargetSeasonEnv("24")).toBeNull();
    expect(parseTargetSeasonEnv("20244")).toBeNull();
    expect(parseTargetSeasonEnv("two thousand")).toBeNull();
  });
});

describe("resolveTargetSeasonWithoutDatabase", () => {
  it("falls back to the calendar and reports no override", () => {
    delete process.env[TARGET_SEASON_ENV];
    const resolved = resolveTargetSeasonWithoutDatabase(new Date("2026-08-19T12:00:00Z"));
    expect(resolved).toMatchObject({ seasonYear: 2026, source: "calendar", isOverride: false });
  });

  it("uses the environment variable and flags it as an override", () => {
    process.env[TARGET_SEASON_ENV] = "2024";
    const resolved = resolveTargetSeasonWithoutDatabase(new Date("2026-08-19T12:00:00Z"));
    expect(resolved).toMatchObject({
      seasonYear: 2024,
      source: "environment",
      calendarSeasonYear: 2026,
      isOverride: true,
    });
  });

  it("does not call an env value that matches the calendar an override", () => {
    process.env[TARGET_SEASON_ENV] = "2026";
    const resolved = resolveTargetSeasonWithoutDatabase(new Date("2026-08-19T12:00:00Z"));
    expect(resolved.isOverride).toBe(false);
  });
});

describe("resolveTargetSeason", () => {
  it("prefers the database row over the environment variable", async () => {
    process.env[TARGET_SEASON_ENV] = "2023";
    const resolved = await resolveTargetSeason(
      fakeSupabase({ data: { season_year: 2024, reason: "free plan", updated_at: "2026-08-19T20:00:00Z" }, error: null }),
      "api-football",
      new Date("2026-08-19T12:00:00Z"),
    );
    expect(resolved).toMatchObject({
      seasonYear: 2024,
      source: "database",
      isOverride: true,
      reason: "free plan",
    });
  });

  it("falls through to the environment variable when there is no row", async () => {
    process.env[TARGET_SEASON_ENV] = "2023";
    const resolved = await resolveTargetSeason(
      fakeSupabase({ data: null, error: null }),
      "api-football",
      new Date("2026-08-19T12:00:00Z"),
    );
    expect(resolved).toMatchObject({ seasonYear: 2023, source: "environment" });
  });

  it("falls through on a failed read rather than changing which season syncs", async () => {
    // A transient database error must never silently move the pipeline to a
    // different season.
    delete process.env[TARGET_SEASON_ENV];
    const resolved = await resolveTargetSeason(
      fakeSupabase({ data: null, error: { message: "connection reset" } }),
      "api-football",
      new Date("2026-08-19T12:00:00Z"),
    );
    expect(resolved).toMatchObject({ seasonYear: 2026, source: "calendar" });
  });
});

describe("describeTargetSeason", () => {
  it("names the season plainly when it is the calendar's", () => {
    const sentence = describeTargetSeason({
      seasonYear: 2026,
      source: "calendar",
      calendarSeasonYear: 2026,
      isOverride: false,
      reason: null,
      setAt: null,
    });
    expect(sentence).toContain("2026/27");
    expect(sentence).toContain("current season");
  });

  it("says out loud that an override is not the current season, and why", () => {
    const sentence = describeTargetSeason({
      seasonYear: 2024,
      source: "database",
      calendarSeasonYear: 2026,
      isOverride: true,
      reason: "free plan covers 2022-2024",
      setAt: "2026-08-19T20:00:00Z",
    });
    expect(sentence).toContain("2024/25");
    expect(sentence).toContain("not the current 2026/27 season");
    expect(sentence).toContain("free plan covers 2022-2024");
  });
});
