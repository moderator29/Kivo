import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_REGISTRY,
  notificationDedupeMode,
  type NotificationType,
} from "@/lib/notification-registry";
import { buildDedupeKey } from "@/lib/notification-payloads";

/**
 * The rule these tests protect is not "notifications are deduplicated". It is
 * the distinction underneath that, which a real defect turned on: two writes
 * that look identical to the database mean different things depending on why
 * the second one happened.
 *
 * A seeded account's bell held gameweek 4 twice, with two different totals — 28
 * and 36 — while `fantasy_points` held only 36. The obvious fix, a unique key
 * with `on conflict do nothing`, would have kept the stale 28 and thrown away
 * the correction. So the mode has to be a property of the type, and the types
 * whose payload is COMPUTED have to be on the superseding side of the line.
 */

describe("dedupe mode is declared for every registered type", () => {
  it("covers the whole registry", () => {
    for (const type of Object.keys(NOTIFICATION_REGISTRY) as NotificationType[]) {
      expect(["none", "ignore", "supersede"]).toContain(notificationDedupeMode(type));
    }
  });

  it("falls back to none for a type nobody has reasoned about", () => {
    // Writing plainly is what an unregistered type did before this existed.
    // Silently deduplicating it would be the worse guess.
    expect(notificationDedupeMode("some_future_type")).toBe("none");
  });
});

describe("computed payloads supersede", () => {
  it("puts every recomputable type on the superseding side", () => {
    // Each of these carries a number or a line that a later, better-informed
    // run can legitimately change: a gameweek total, a scoreline, a transfer's
    // details, a settled prediction.
    for (const type of [
      "fantasy_points",
      "fantasy_roster_carried",
      "match_result",
      "match_halftime",
      "transfer_recorded",
      "prediction_result",
    ] as const) {
      expect(notificationDedupeMode(type)).toBe("supersede");
    }
  });

  it("leaves one-time match moments on first-write-wins", () => {
    // Re-syncing a fixture re-reads a goal; it does not make it happen again,
    // and the first row already describes it correctly.
    for (const type of ["match_goal", "match_penalty", "match_red_card", "match_kickoff", "match_lineups"] as const) {
      expect(notificationDedupeMode(type)).toBe("ignore");
    }
  });

  it("keeps toggle-shaped social types out of keyed dedupe entirely", () => {
    // These are governed by "don't stack UNREAD duplicates" in their producers,
    // which is deliberately weaker than a permanent key: once the recipient has
    // read the last one, a later like or re-follow is genuinely new. A unique
    // key cannot express that, because its constraint never expires.
    for (const type of ["post_like", "new_follower", "post_comment", "comment_reply"] as const) {
      expect(notificationDedupeMode(type)).toBe("none");
    }
  });
});

describe("buildDedupeKey", () => {
  it("is stable across calls for the same event", () => {
    expect(buildDedupeKey(["match_goal", "fix-1", "goal", 23, "player-1"])).toBe(
      buildDedupeKey(["match_goal", "fix-1", "goal", 23, "player-1"]),
    );
  });

  it("distinguishes a null part from a missing one rather than collapsing them", () => {
    // "-" for an absent part, so a goal with no recorded scorer cannot collide
    // with a different event that simply has fewer parts.
    expect(buildDedupeKey(["match_goal", "fix-1", null])).toBe("match_goal:fix-1:-");
    expect(buildDedupeKey(["match_goal", "fix-1"])).toBe("match_goal:fix-1");
  });

  it("separates two goals by the same player at different minutes", () => {
    expect(buildDedupeKey(["match_goal", "fix-1", "goal", 23, "p1"])).not.toBe(
      buildDedupeKey(["match_goal", "fix-1", "goal", 67, "p1"]),
    );
  });

  it("separates the two fantasy types for one gameweek and team", () => {
    // A squad carried and unscored this run, then scored on a later run, is a
    // different notification — not a correction of the carry notice.
    expect(buildDedupeKey(["fantasy_points", "gw-1", "team-1"])).not.toBe(
      buildDedupeKey(["fantasy_roster_carried", "gw-1", "team-1"]),
    );
  });
});
