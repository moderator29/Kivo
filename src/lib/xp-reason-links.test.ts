import { describe, expect, it } from "vitest";
import { xpReasonLink } from "@/lib/xp-reason-links";

/**
 * These tests exist because of a real regression, not a hypothetical one.
 *
 * `xpReasonLink` used to match the exact reason string a writer had used.
 * When predictions grew from one type to six, the writer started composing
 * the reason per type — "Correct winner prediction", "Correct man of the
 * match prediction" — and every prediction row on /rewards silently stopped
 * matching. Nothing failed, nothing logged; the links just went dead.
 *
 * The fix keys on `source_key`, whose `kind:id` shape the award path has to
 * get right for idempotency anyway. The first test below is the one that
 * would have caught the regression.
 */
describe("xpReasonLink", () => {
  it("links every prediction award by source, whatever the reason says", () => {
    for (const reason of [
      "Correct prediction · Winner",
      "Correct prediction · Man of the match",
      "Prediction re-scored · Cards & corners",
      "some wording nobody has written yet",
    ]) {
      expect(xpReasonLink(reason, "prediction:0e5f1c22-1111-2222-3333-444455556666")).toEqual({
        href: "/predictions/mine",
        label: "Your predictions",
      });
    }
  });

  it("sends a reconciliation adjustment to the same place as the award it corrects", () => {
    const award = xpReasonLink("Correct prediction · Winner", "prediction:abc");
    const adjustment = xpReasonLink("Prediction re-scored · Winner", "prediction:abc:adj:1");
    expect(adjustment).toEqual(award);
  });

  it("links all four community post sources identically, because they are all posts", () => {
    expect(xpReasonLink("Posted in the community", "post:abc")?.href).toBe("/social");
  });

  it("falls back to the reason for legacy rows written before source_key existed", () => {
    expect(xpReasonLink("Correct match prediction", null)?.href).toBe("/predictions/mine");
    expect(xpReasonLink("Posted in the community")?.href).toBe("/social");
    expect(xpReasonLink("Completed onboarding", null)?.href).toBe("/profile");
  });

  it("matches a legacy reason by its opening, so a suffix cannot break it again", () => {
    expect(xpReasonLink("Correct prediction · Total goals", null)?.href).toBe("/predictions/mine");
  });

  it("returns null rather than routing an unknown source somewhere plausible", () => {
    expect(xpReasonLink("Something new entirely", "brand-new-kind:abc")).toBeNull();
    expect(xpReasonLink("Something new entirely", null)).toBeNull();
  });
});
