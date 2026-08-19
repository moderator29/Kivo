import { describe, expect, it } from "vitest";
import { CAPPED_LIST_STEP, cappedListStatus, hasMoreToShow, nextVisibleCount } from "./capped-list";

describe("nextVisibleCount", () => {
  it("reveals one more step", () => {
    expect(nextVisibleCount(60, 500)).toBe(120);
  });

  it("stops exactly at the end rather than overshooting", () => {
    expect(nextVisibleCount(480, 500)).toBe(500);
    expect(nextVisibleCount(500, 500)).toBe(500);
  });

  it("never exceeds a total smaller than one step", () => {
    expect(nextVisibleCount(0, 7)).toBe(7);
  });

  it("handles an empty list without going negative", () => {
    expect(nextVisibleCount(0, 0)).toBe(0);
    expect(nextVisibleCount(60, 0)).toBe(0);
  });

  it("recovers from a nonsense current count instead of propagating it", () => {
    expect(nextVisibleCount(Number.NaN, 500)).toBe(CAPPED_LIST_STEP);
    expect(nextVisibleCount(-5, 500)).toBe(CAPPED_LIST_STEP);
  });

  it("takes a caller's own step", () => {
    expect(nextVisibleCount(10, 500, 25)).toBe(35);
  });
});

describe("hasMoreToShow", () => {
  it("is true while rows remain", () => {
    expect(hasMoreToShow(60, 500)).toBe(true);
  });

  it("is false once everything is on screen", () => {
    expect(hasMoreToShow(500, 500)).toBe(false);
    expect(hasMoreToShow(600, 500)).toBe(false);
  });

  it("is false for an empty list, so no control is offered over nothing", () => {
    expect(hasMoreToShow(0, 0)).toBe(false);
  });
});

describe("cappedListStatus", () => {
  it("says the real numbers while the list is capped", () => {
    expect(cappedListStatus(60, 500)).toBe("Showing 60 of 500");
  });

  // Silence is the correct answer when there is nothing being withheld — a
  // "showing 12 of 12" line is noise that makes a short list look truncated.
  it("says nothing once everything is shown", () => {
    expect(cappedListStatus(500, 500)).toBeNull();
    expect(cappedListStatus(12, 12)).toBeNull();
  });

  it("says nothing for an empty list", () => {
    expect(cappedListStatus(60, 0)).toBeNull();
  });

  it("never claims to show more than there are", () => {
    expect(cappedListStatus(600, 500)).toBeNull();
  });
});
