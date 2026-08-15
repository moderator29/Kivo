import { describe, expect, it } from "vitest";
import { summarizeGoalTiming } from "./goal-timing";
import { MIN_FORM_SAMPLE } from "./form-engine";

describe("summarizeGoalTiming", () => {
  it("counts real goals after the 70th minute against the real total", () => {
    const timing = summarizeGoalTiming([12, 45, 71, 88, 90], 8);
    expect(timing.goalsScored).toBe(5);
    expect(timing.goalsAfter70).toBe(3);
    expect(timing.finishedMatchesSample).toBe(8);
    expect(timing.isSufficientSample).toBe(true);
    expect(timing.minSampleRequired).toBe(MIN_FORM_SAMPLE);
  });

  it("treats minute 70 itself as after the 70th minute (>= 70, matching the original inline logic)", () => {
    const timing = summarizeGoalTiming([70], 5);
    expect(timing.goalsAfter70).toBe(1);
  });

  it("reports zero goals honestly rather than dividing by zero", () => {
    const timing = summarizeGoalTiming([], 3);
    expect(timing.goalsScored).toBe(0);
    expect(timing.goalsAfter70).toBe(0);
  });

  it("marks an insufficient real match sample rather than presenting a trend from too little data", () => {
    const zero = summarizeGoalTiming([], 0);
    expect(zero.isSufficientSample).toBe(false);

    const one = summarizeGoalTiming([10], 1);
    expect(one.isSufficientSample).toBe(false);

    const enough = summarizeGoalTiming([10, 80], MIN_FORM_SAMPLE);
    expect(enough.isSufficientSample).toBe(true);
  });
});
