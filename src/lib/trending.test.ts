import { describe, expect, it } from "vitest";
import {
  MIN_SENTIMENT_RATINGS,
  MIN_TRENDING_PARTICIPANTS,
  TRENDING_WINDOW_HOURS,
  sentimentReading,
  trendingVerdict,
  trendingWindowStart,
} from "@/lib/trending";

/**
 * Every test here is about refusing to call something a trend.
 *
 * The happy path — real counts, ranked — is the easy half and the half that
 * would still pass if the thresholds were quietly removed. These are the ones
 * that would not.
 */

const room = (participantCount: number) => ({
  fixtureId: `f-${participantCount}`,
  postCount: 40,
  commentCount: 40,
  participantCount,
});

describe("trendingVerdict", () => {
  it("says nothing happened when nothing happened", () => {
    expect(trendingVerdict([])).toEqual({ kind: "empty" });
  });

  it("refuses to rank one very talkative person", () => {
    // 80 posts and comments, all from one account. Raw volume would call this
    // the biggest thing on the platform.
    const verdict = trendingVerdict([room(1)]);
    expect(verdict.kind).toBe("too-quiet");
  });

  it("reports the real numbers when it declines to rank", () => {
    const verdict = trendingVerdict([room(2), room(1)]);
    expect(verdict).toEqual({ kind: "too-quiet", participants: 2, items: 2 });
  });

  it("does not let a dozen one-person rooms add up to a trend", () => {
    // Summing participants across rows would reach 12 here and rank all of
    // them. None of them is a conversation.
    const verdict = trendingVerdict(Array.from({ length: 12 }, () => room(1)));
    expect(verdict.kind).toBe("too-quiet");
  });

  it("ranks once one entry has real people in it", () => {
    const verdict = trendingVerdict([room(MIN_TRENDING_PARTICIPANTS), room(1)]);
    expect(verdict.kind).toBe("ranked");
  });

  it("drops the entries that do not clear the bar from a real ranking", () => {
    // A ranking whose third place is one person talking to themselves
    // undermines the two above it.
    const verdict = trendingVerdict([room(9), room(4), room(1)]);
    if (verdict.kind !== "ranked") throw new Error("expected a ranking");
    expect(verdict.rows).toHaveLength(2);
    expect(verdict.rows.every((row) => row.participantCount >= MIN_TRENDING_PARTICIPANTS)).toBe(true);
  });
});

describe("trendingWindowStart", () => {
  it("is exactly the stated window, so the number and the claim agree", () => {
    const now = new Date("2026-08-19T12:00:00Z");
    expect(now.getTime() - trendingWindowStart(now).getTime()).toBe(TRENDING_WINDOW_HOURS * 3_600_000);
  });
});

describe("sentimentReading", () => {
  const base = { fixtureId: "f", pollCount: 0, pollVoteCount: 0 };

  it("says nothing rather than zero when nobody has rated", () => {
    // 0 would read as "everybody hated it" rather than "nobody has said".
    expect(sentimentReading({ ...base, ratingCount: 0, avgRating: null })).toEqual({ kind: "none" });
  });

  it("refuses to average one person's mood into a sentiment", () => {
    expect(sentimentReading({ ...base, ratingCount: 1, avgRating: 5 })).toEqual({
      kind: "too-few",
      ratingCount: 1,
    });
  });

  it("reports the real average once there are enough real ratings", () => {
    expect(sentimentReading({ ...base, ratingCount: MIN_SENTIMENT_RATINGS, avgRating: 3.8 })).toEqual({
      kind: "real",
      avgRating: 3.8,
      ratingCount: MIN_SENTIMENT_RATINGS,
    });
  });

  it("never returns a word, only a number and a count", () => {
    const reading = sentimentReading({ ...base, ratingCount: 41, avgRating: 4.2 });
    expect(reading).not.toHaveProperty("label");
    expect(Object.values(reading).every((value) => typeof value !== "string" || value === "real")).toBe(true);
  });
});
