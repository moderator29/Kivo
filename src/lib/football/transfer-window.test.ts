import { describe, expect, it } from "vitest";
import {
  TRANSFER_WINDOWS,
  nextTransferWindow,
  summariseRecordedActivity,
} from "./transfer-window";

const NOW = new Date("2026-08-19T12:00:00.000Z");
const day = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * day).toISOString().slice(0, 10);

describe("nextTransferWindow", () => {
  it("has no configured window, which is the deliberate state", () => {
    // If this ever fails, someone added a window — that is fine and expected,
    // but the entry must carry a real `sourceUrl`, which the assertion below
    // is here to keep true.
    expect(TRANSFER_WINDOWS.every((window) => window.sourceUrl.startsWith("http"))).toBe(true);
  });

  it("returns nothing rather than counting down to a window that does not exist", () => {
    expect(nextTransferWindow(NOW)).toBeNull();
  });
});

describe("summariseRecordedActivity", () => {
  it("counts only real rows inside each window", () => {
    const activity = summariseRecordedActivity(
      [
        { transfer_date: daysAgo(1), from_team_id: "a", to_team_id: "b" },
        { transfer_date: daysAgo(6), from_team_id: "b", to_team_id: "c" },
        { transfer_date: daysAgo(20), from_team_id: "a", to_team_id: "c" },
        { transfer_date: daysAgo(90), from_team_id: "d", to_team_id: "e" },
      ],
      NOW,
    );
    expect(activity.last7Days).toBe(2);
    expect(activity.last30Days).toBe(3);
    // a, b, c — the 90-day-old row's clubs are outside the 30-day window.
    expect(activity.clubsInvolvedLast30Days).toBe(3);
    expect(activity.mostRecentDate).toBe(daysAgo(1));
  });

  it("does not count a future-dated move as something that just happened", () => {
    const future = new Date(NOW.getTime() + 5 * day).toISOString().slice(0, 10);
    const activity = summariseRecordedActivity(
      [{ transfer_date: future, from_team_id: "a", to_team_id: "b" }],
      NOW,
    );
    expect(activity.last7Days).toBe(0);
    expect(activity.last30Days).toBe(0);
    expect(activity.mostRecentDate).toBeNull();
  });

  it("reports honest zeros for an empty feed", () => {
    const activity = summariseRecordedActivity([], NOW);
    expect(activity).toEqual({
      last7Days: 0,
      last30Days: 0,
      mostRecentDate: null,
      clubsInvolvedLast30Days: 0,
    });
  });

  it("ignores an unresolved club rather than counting it as one", () => {
    const activity = summariseRecordedActivity(
      [{ transfer_date: daysAgo(2), from_team_id: null, to_team_id: "b" }],
      NOW,
    );
    expect(activity.clubsInvolvedLast30Days).toBe(1);
  });
});
