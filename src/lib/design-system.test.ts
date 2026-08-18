import { describe, expect, it } from "vitest";
import { GRADIENTS, ICON_SIZES, SURFACE_TIERS, TOKEN_GROUPS, iconStrokeWidth } from "./design-system";
import { expectedStrokeWidth, sizeFromClassName } from "../../eslint-rules/icon-stroke-weight.mjs";

/**
 * The lint rule (plain ESM, loaded by the flat config) and the design system
 * (TypeScript, imported by components) each carry a copy of the icon stroke
 * scale, because ESLint config cannot import TypeScript. That duplication is
 * only safe if something fails when the two disagree — otherwise the rule
 * quietly starts enforcing a scale the app no longer uses, which is a worse
 * failure than having no rule at all.
 */
describe("icon stroke scale", () => {
  it("agrees between the design system and the lint rule at every size", () => {
    for (let size = 1; size <= 64; size += 1) {
      expect(expectedStrokeWidth(size), `size ${size}px`).toBe(iconStrokeWidth(size));
    }
  });

  it("is monotonically non-increasing — bigger icons never get a heavier stroke", () => {
    for (let size = 2; size <= 64; size += 1) {
      expect(iconStrokeWidth(size)).toBeLessThanOrEqual(iconStrokeWidth(size - 1));
    }
  });

  it("gives every named size a weight", () => {
    for (const px of Object.values(ICON_SIZES)) {
      expect(iconStrokeWidth(px)).toBeGreaterThan(0);
    }
  });
});

describe("size parsing from Tailwind classes", () => {
  it("reads the Tailwind 0.25rem step", () => {
    expect(sizeFromClassName("h-4 w-4 text-accent")).toBe(16);
    expect(sizeFromClassName("h-3.5 w-3.5")).toBe(14);
    expect(sizeFromClassName("shrink-0 h-8 w-8")).toBe(32);
  });

  it("reads an arbitrary pixel value", () => {
    expect(sizeFromClassName("h-[18px] w-[18px] shrink-0")).toBe(18);
  });

  it("does not mistake a similarly-named class for a height", () => {
    // `h-full` and `max-h-4` must not be read as a height step — the first has
    // no numeric size at all, the second is a different property.
    expect(sizeFromClassName("h-full w-full")).toBeNull();
    expect(sizeFromClassName("max-h-4")).toBeNull();
  });

  it("returns null when there is no height at all", () => {
    expect(sizeFromClassName("text-accent")).toBeNull();
    expect(sizeFromClassName(undefined)).toBeNull();
  });
});

/**
 * The reference page renders these lists directly, so an entry with an empty
 * rule would ship as a blank cell claiming to document something.
 */
describe("design system catalogue", () => {
  it("gives every token a rule", () => {
    for (const group of TOKEN_GROUPS) {
      expect(group.tokens.length, group.id).toBeGreaterThan(0);
      for (const token of group.tokens) {
        expect(token.varName.startsWith("--"), token.varName).toBe(true);
        expect(token.rule.length, token.varName).toBeGreaterThan(10);
      }
    }
  });

  it("lists no token twice, so the page cannot show two rules for one value", () => {
    const names = TOKEN_GROUPS.flatMap((group) => group.tokens.map((token) => token.varName));
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every surface tier and gradient a rule", () => {
    for (const tier of SURFACE_TIERS) expect(tier.rule.length, tier.className).toBeGreaterThan(10);
    for (const gradient of GRADIENTS) expect(gradient.rule.length, gradient.className).toBeGreaterThan(10);
  });
});
