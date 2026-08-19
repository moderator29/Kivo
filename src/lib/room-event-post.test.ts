import { describe, expect, it } from "vitest";
import { parseRoomEventPost } from "./room-event-post";

describe("parseRoomEventPost", () => {
  it("reads a goal exactly as insertSystemEventPost writes one", () => {
    expect(parseRoomEventPost("⚽ GOAL — Bukayo Saka (Arsenal), 67'")).toEqual({
      kind: "goal",
      minute: "67",
      playerName: "Bukayo Saka",
      teamName: "Arsenal",
    });
  });

  it("reads a red card, including stoppage-time minutes", () => {
    expect(parseRoomEventPost("🟥 RED CARD — Casemiro (Manchester United), 45+2'")).toEqual({
      kind: "red-card",
      minute: "45+2",
      playerName: "Casemiro",
      teamName: "Manchester United",
    });
  });

  it("keeps the whole player name when it contains spaces and punctuation", () => {
    expect(parseRoomEventPost("⚽ GOAL — N'Golo Kanté (Al-Ittihad), 12'")?.playerName).toBe("N'Golo Kanté");
  });

  it("uses the LAST bracketed group as the club, so a bracketed player name cannot shift the fields", () => {
    const parsed = parseRoomEventPost("⚽ GOAL — Vinícius Júnior (Jr) (Real Madrid), 90+5'");
    expect(parsed?.playerName).toBe("Vinícius Júnior (Jr)");
    expect(parsed?.teamName).toBe("Real Madrid");
    expect(parsed?.minute).toBe("90+5");
  });

  it("returns null for anything it was not written to read", () => {
    // A fan's own post, which must never be dressed up as a match event.
    expect(parseRoomEventPost("GOAL!!! what a finish")).toBeNull();
    expect(parseRoomEventPost("⚽ GOAL — Saka, 67'")).toBeNull();
    expect(parseRoomEventPost("")).toBeNull();
    // A future system post shape this parser has not been taught.
    expect(parseRoomEventPost("🟨 YELLOW CARD — Rice (Arsenal), 20'")).toBeNull();
  });
});
