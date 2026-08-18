import { describe, expect, it } from "vitest";
import { xpReasonLink } from "./xp-reason-links";

describe("xpReasonLink", () => {
  it("routes each real XP reason its writers use to the surface it belongs to", () => {
    expect(xpReasonLink("Correct match prediction")?.href).toBe("/predictions/mine");
    expect(xpReasonLink("Posted in the community")?.href).toBe("/social");
    expect(xpReasonLink("Completed onboarding")?.href).toBe("/profile");
  });

  it("is insensitive to casing and surrounding whitespace", () => {
    expect(xpReasonLink("  POSTED IN THE COMMUNITY ")?.href).toBe("/social");
  });

  it("returns null for a reason it does not recognise rather than guessing a destination", () => {
    expect(xpReasonLink("Won a thing")).toBeNull();
    expect(xpReasonLink("")).toBeNull();
  });
});
