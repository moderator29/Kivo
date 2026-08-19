import { describe, expect, it } from "vitest";
import {
  backAccessibleLabel,
  canPopHistory,
  initialInAppDepth,
  nextDepth,
  normaliseDepth,
} from "./back-navigation";

describe("normaliseDepth", () => {
  it("keeps a real count", () => {
    expect(normaliseDepth(3)).toBe(3);
  });

  it("floors a fractional count rather than trusting it", () => {
    expect(normaliseDepth(2.9)).toBe(2);
  });

  it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, 0])(
    "treats %p as no history",
    (value) => {
      expect(normaliseDepth(value as number)).toBe(0);
    },
  );
});

describe("initialInAppDepth", () => {
  // The case the whole component exists for: a fixture opened from a shared
  // WhatsApp link. There is a history entry behind it — the chat, the search
  // results, whatever — and popping to it walks the user out of KIVO.
  it("starts a document navigation at zero even when this tab held a session before", () => {
    expect(initialInAppDepth("navigate", 7)).toBe(0);
  });

  it("keeps the count across a reload, where the stack behind is intact", () => {
    expect(initialInAppDepth("reload", 4)).toBe(4);
  });

  it("keeps the count when the browser restores the page from bfcache", () => {
    expect(initialInAppDepth("back_forward", 2)).toBe(2);
  });

  it("starts at zero when a restored document has nothing stored", () => {
    expect(initialInAppDepth("reload", null)).toBe(0);
  });

  it("starts at zero when the browser reports no navigation type at all", () => {
    expect(initialInAppDepth(null, 9)).toBe(0);
  });

  it("refuses a corrupted stored value", () => {
    expect(initialInAppDepth("reload", Number.NaN)).toBe(0);
    expect(initialInAppDepth("reload", -3)).toBe(0);
  });
});

describe("nextDepth", () => {
  it("counts a push", () => {
    expect(nextDepth(0, "push")).toBe(1);
    expect(nextDepth(2, "push")).toBe(3);
  });

  it("counts a traversal back off the stack", () => {
    expect(nextDepth(2, "pop")).toBe(1);
  });

  it("never goes below zero, however many traversals arrive", () => {
    expect(nextDepth(0, "pop")).toBe(0);
    expect(nextDepth(nextDepth(1, "pop"), "pop")).toBe(0);
  });

  // A forward press is a popstate too and cannot be told apart from a back
  // press by the event alone. Under-counting costs one push to the declared
  // parent; over-counting would send the user out of the app.
  it("resolves the ambiguous forward press toward the safe answer", () => {
    expect(nextDepth(1, "pop")).toBe(0);
  });

  it("survives a whole session: three taps in, two backs out", () => {
    let depth = initialInAppDepth("navigate", null);
    expect(canPopHistory(depth)).toBe(false);
    depth = nextDepth(depth, "push");
    depth = nextDepth(depth, "push");
    depth = nextDepth(depth, "push");
    expect(canPopHistory(depth)).toBe(true);
    depth = nextDepth(depth, "pop");
    depth = nextDepth(depth, "pop");
    expect(depth).toBe(1);
    expect(canPopHistory(depth)).toBe(true);
    depth = nextDepth(depth, "pop");
    expect(canPopHistory(depth)).toBe(false);
  });
});

describe("canPopHistory", () => {
  it("is false with nothing of KIVO's behind the page", () => {
    expect(canPopHistory(0)).toBe(false);
  });

  it("is true once KIVO has pushed an entry of its own", () => {
    expect(canPopHistory(1)).toBe(true);
  });

  it("refuses a nonsense depth rather than guessing", () => {
    expect(canPopHistory(Number.NaN)).toBe(false);
    expect(canPopHistory(-2)).toBe(false);
  });
});

describe("backAccessibleLabel", () => {
  it("names the direction as well as the destination", () => {
    expect(backAccessibleLabel("Matches")).toBe("Back to Matches");
  });

  // WCAG 2.5.3: a voice-control user says what they can see, so the visible
  // text has to survive inside the accessible name.
  it("keeps the visible label inside the accessible name", () => {
    expect(backAccessibleLabel("Edit profile")).toContain("Edit profile");
  });

  it("falls back to a bare Back rather than 'Back to '", () => {
    expect(backAccessibleLabel("")).toBe("Back");
    expect(backAccessibleLabel("   ")).toBe("Back");
  });

  it("trims a padded label", () => {
    expect(backAccessibleLabel("  Settings ")).toBe("Back to Settings");
  });
});
