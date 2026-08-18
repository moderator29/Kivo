import { describe, expect, it } from "vitest";
import { formatRetryAfter } from "./rate-limit-format";

describe("formatRetryAfter", () => {
  it("names seconds exactly inside the first minute", () => {
    expect(formatRetryAfter(1)).toBe("1 second");
    expect(formatRetryAfter(45)).toBe("45 seconds");
    // Rounds up, so 59.2s crosses into the minute band rather than claiming a
    // wait shorter than the one the window will actually enforce.
    expect(formatRetryAfter(59.2)).toBe("about 1 minute");
    expect(formatRetryAfter(59)).toBe("59 seconds");
  });

  it("goes coarse past a minute, because a sliding window moves while you read it", () => {
    expect(formatRetryAfter(60)).toBe("about 1 minute");
    expect(formatRetryAfter(231)).toBe("about 4 minutes");
    expect(formatRetryAfter(3600)).toBe("about 1 hour");
    expect(formatRetryAfter(7200)).toBe("about 2 hours");
  });

  it("reaches days, so a 24h cap is never described as 'a moment'", () => {
    expect(formatRetryAfter(86_400)).toBe("about 1 day");
  });

  it("never renders a zero or negative wait", () => {
    expect(formatRetryAfter(0)).toBe("1 second");
    expect(formatRetryAfter(-10)).toBe("1 second");
  });
});
