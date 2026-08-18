import { describe, expect, it } from "vitest";
import { MAX_MENTION_PHRASES, extractMentionPhrases } from "./mention-phrases";

describe("extractMentionPhrases", () => {
  it("finds a club that is only ever typed lowercase", () => {
    expect(extractMentionPhrases("how did arsenal do today?")).toContain("arsenal");
  });

  it("keeps a multi-word club name whole even though one half is generic", () => {
    const phrases = extractMentionPhrases("is manchester united playing tonight");
    expect(phrases).toContain("manchester united");
    // "united" alone would trigram-match half the football world.
    expect(phrases).not.toContain("united");
  });

  it("never emits a phrase starting or ending on a function word", () => {
    for (const phrase of extractMentionPhrases("what is the form of the arsenal squad")) {
      expect(phrase.startsWith("the ")).toBe(false);
      expect(phrase.endsWith(" the")).toBe(false);
      expect(phrase).not.toBe("the");
    }
  });

  it("keeps accented and hyphenated names intact", () => {
    expect(extractMentionPhrases("tell me about mönchengladbach")).toContain("mönchengladbach");
    expect(extractMentionPhrases("how is saint-étienne doing")).toContain("saint-étienne");
  });

  it("drops scorelines and other bare numbers", () => {
    const phrases = extractMentionPhrases("they won 3 2 in the end");
    expect(phrases).not.toContain("3");
    expect(phrases).not.toContain("3 2");
  });

  it("emits nothing for a message with no candidate names", () => {
    expect(extractMentionPhrases("what can you do?")).toEqual([]);
    expect(extractMentionPhrases("")).toEqual([]);
  });

  it("caps the phrase count and keeps the longest, most specific spans", () => {
    const long = "compare manchester united and real madrid and bayern munich and paris saint germain this season";
    const phrases = extractMentionPhrases(long);
    expect(phrases.length).toBeLessThanOrEqual(MAX_MENTION_PHRASES);
    // The cap must not throw away the three-word spans in favour of one-word ones.
    expect(phrases.some((p) => p.split(" ").length === 3)).toBe(true);
  });

  it("de-duplicates a name repeated in one message", () => {
    const phrases = extractMentionPhrases("arsenal arsenal arsenal");
    expect(phrases.filter((p) => p === "arsenal")).toHaveLength(1);
  });
});
