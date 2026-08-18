import { describe, expect, it } from "vitest";
import { isAuthorizedCronRequest, isFixtureWorthSyncing } from "./live-worker-rules";

const NOW = new Date("2026-08-18T15:00:00.000Z");
const WINDOW = { imminentWindowMinutes: 10, staleScheduledCeilingHours: 3, now: NOW };

describe("isFixtureWorthSyncing", () => {
  it("always counts a live fixture, regardless of kickoff time", () => {
    expect(isFixtureWorthSyncing("live", "2026-08-18T10:00:00.000Z", WINDOW)).toBe(true);
  });

  it("always counts a halftime fixture, regardless of kickoff time", () => {
    expect(isFixtureWorthSyncing("halftime", "2026-08-18T10:00:00.000Z", WINDOW)).toBe(true);
  });

  it("counts a scheduled fixture kicking off within the imminent window", () => {
    expect(isFixtureWorthSyncing("scheduled", "2026-08-18T15:05:00.000Z", WINDOW)).toBe(true);
  });

  it("counts a scheduled fixture kicking off exactly at the imminent window boundary", () => {
    expect(isFixtureWorthSyncing("scheduled", "2026-08-18T15:10:00.000Z", WINDOW)).toBe(true);
  });

  it("does not count a scheduled fixture kicking off just past the imminent window", () => {
    expect(isFixtureWorthSyncing("scheduled", "2026-08-18T15:10:00.001Z", WINDOW)).toBe(false);
  });

  it("does not count a scheduled fixture kicking off hours from now", () => {
    expect(isFixtureWorthSyncing("scheduled", "2026-08-18T20:00:00.000Z", WINDOW)).toBe(false);
  });

  it("counts a scheduled fixture whose kickoff already passed, inside the stale ceiling", () => {
    // Kickoff was 1 hour ago and the provider never flipped it to live/finished —
    // still worth checking again, same as any match currently in progress.
    expect(isFixtureWorthSyncing("scheduled", "2026-08-18T14:00:00.000Z", WINDOW)).toBe(true);
  });

  it("does not count a scheduled fixture whose kickoff is past the stale ceiling", () => {
    // 3 hours and 1 minute ago — a provider data gap this worker can't fix
    // by asking again every minute forever.
    expect(isFixtureWorthSyncing("scheduled", "2026-08-18T11:59:00.000Z", WINDOW)).toBe(false);
  });

  it("counts a scheduled fixture exactly at the stale ceiling boundary", () => {
    expect(isFixtureWorthSyncing("scheduled", "2026-08-18T12:00:00.000Z", WINDOW)).toBe(true);
  });

  for (const status of ["finished", "postponed", "cancelled", "abandoned", "unknown"] as const) {
    it(`never counts a '${status}' fixture, even with an imminent kickoff`, () => {
      expect(isFixtureWorthSyncing(status, "2026-08-18T15:05:00.000Z", WINDOW)).toBe(false);
    });
  }

  it("defaults `now` to the real current time when not injected", () => {
    const soon = new Date(Date.now() + 5 * 60_000).toISOString();
    expect(isFixtureWorthSyncing("scheduled", soon, { imminentWindowMinutes: 10, staleScheduledCeilingHours: 3 })).toBe(
      true,
    );
  });
});

describe("isAuthorizedCronRequest", () => {
  it("authorizes a matching bearer token", () => {
    expect(isAuthorizedCronRequest("Bearer real-secret", "real-secret")).toBe(true);
  });

  it("rejects a missing authorization header", () => {
    expect(isAuthorizedCronRequest(null, "real-secret")).toBe(false);
  });

  it("rejects a mismatched token", () => {
    expect(isAuthorizedCronRequest("Bearer wrong-secret", "real-secret")).toBe(false);
  });

  it("rejects a header missing the 'Bearer ' prefix", () => {
    expect(isAuthorizedCronRequest("real-secret", "real-secret")).toBe(false);
  });

  it("fails closed when CRON_SECRET itself is unset, even with a header present", () => {
    expect(isAuthorizedCronRequest("Bearer anything", undefined)).toBe(false);
    expect(isAuthorizedCronRequest("Bearer anything", null)).toBe(false);
    expect(isAuthorizedCronRequest("Bearer anything", "")).toBe(false);
  });

  it("fails closed when both the header and the secret are absent", () => {
    expect(isAuthorizedCronRequest(null, undefined)).toBe(false);
  });
});
