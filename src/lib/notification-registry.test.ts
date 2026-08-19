import { describe, expect, it, vi } from "vitest";
import {
  NOTIFICATION_GROUPS,
  NOTIFICATION_REGISTRY,
  describeNotification,
  notificationHref,
  type NotificationType,
} from "@/lib/notification-registry";

/**
 * The registry's two structural promises, and the three types that just
 * joined it.
 *
 * `notifications.type` is free text in the schema, so nothing in the database
 * enforces any of this. A type that is registered but ungrouped is
 * unreachable by the filter chips; a type that renders a raw snake_case
 * string is a bug a user sees. Both are the kind of thing that only shows up
 * in production, which is exactly what makes them worth a test.
 */

// describeNotification logs when it meets a type it does not know. Stubbed so
// the unregistered-type tests below assert behaviour rather than filling the
// run with console noise — the logging itself is the point of that path, not
// an accident, so it is silenced rather than removed.
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

const ALL_TYPES = Object.keys(NOTIFICATION_REGISTRY) as NotificationType[];

describe("notification registry", () => {
  it("puts every registered type in exactly one filter group", () => {
    const counts = new Map<string, number>();
    for (const group of NOTIFICATION_GROUPS) {
      for (const type of group.types) counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    for (const type of ALL_TYPES) {
      expect(counts.get(type), `${type} should appear in exactly one group`).toBe(1);
    }
  });

  it("never groups a type that is not registered", () => {
    for (const group of NOTIFICATION_GROUPS) {
      for (const type of group.types) {
        expect(ALL_TYPES, `${type} is grouped but not registered`).toContain(type);
      }
    }
  });

  it("gives every type a title and a real destination, even with an empty payload", () => {
    for (const type of ALL_TYPES) {
      const notification = { type, payload: {} };
      expect(describeNotification(notification), `${type} title`).not.toMatch(/^\s*$/);
      // A raw snake_case string is describeNotification's fallback for an
      // UNregistered type — seeing one here would mean the registry and the
      // union had drifted apart.
      expect(describeNotification(notification)).not.toBe(type.replace(/_/g, " "));
      expect(notificationHref(notification), `${type} href`).toMatch(/^\//);
    }
  });
});

describe("the three types the brief named and KIVO never sent", () => {
  const added = ["match_halftime", "match_penalty", "match_lineups"] as const;

  it("are registered", () => {
    for (const type of added) expect(ALL_TYPES).toContain(type);
  });

  it("link to the fixture they are about", () => {
    for (const type of added) {
      expect(notificationHref({ type, payload: { fixture_id: "fix-1", summary: "x" } })).toBe("/matches/fix-1");
    }
  });

  it("render the producer's summary verbatim", () => {
    expect(
      describeNotification({ type: "match_halftime", payload: { fixture_id: "f", summary: "Half time: A 1-0 B" } }),
    ).toBe("Half time: A 1-0 B");
    expect(
      describeNotification({
        type: "match_penalty",
        payload: { fixture_id: "f", summary: "Osimhen misses a penalty for Nigeria (63') vs Senegal" },
      }),
    ).toBe("Osimhen misses a penalty for Nigeria (63') vs Senegal");
  });

  it("fall back to a readable line rather than a blank when a summary is missing", () => {
    for (const type of added) {
      expect(describeNotification({ type, payload: { fixture_id: "f" } })).toMatch(/[a-z]/);
    }
  });

  it("sit in the Matches group", () => {
    const matches = NOTIFICATION_GROUPS.find((group) => group.id === "matches");
    for (const type of added) expect(matches?.types).toContain(type);
  });
});

/**
 * The fallback path — the one part of this module a user should never see
 * working.
 *
 * The registry used to answer an unrecognised type with
 * `type.replace(/_/g, " ")`, which reads as graceful degradation and is really
 * a leak: the reader gets an internal identifier, not a sentence. The tests
 * above prove no *registered* type renders one. These prove an unregistered
 * one cannot either.
 */
describe("an unrecognised type", () => {
  it("never renders as a raw type string", () => {
    const line = describeNotification({ type: "goal", payload: {} });
    expect(line).not.toBe("goal");
    expect(line).not.toMatch(/_/);
    expect(line.trim().length).toBeGreaterThan(0);
  });

  it("still goes somewhere real rather than nowhere", () => {
    expect(notificationHref({ type: "goal", payload: {} })).toBe("/notifications");
  });
});

describe("a registered type with a damaged payload", () => {
  it("never returns a blank line when the summary field is empty text", () => {
    // Distinct from the missing-summary case the tests above cover: a field
    // that exists and is whitespace passes a `?? fallback` untouched, and an
    // empty row in a notification list reads as a rendering bug.
    const line = describeNotification({ type: "match_goal", payload: { summary: "   " } });
    expect(line.trim().length).toBeGreaterThan(0);
  });

  it("uses the producer's summary when there genuinely is one", () => {
    expect(
      describeNotification({
        type: "match_goal",
        payload: { fixture_id: "f1", summary: "Saka scores for Arsenal (12')" },
      }),
    ).toBe("Saka scores for Arsenal (12')");
  });
});
