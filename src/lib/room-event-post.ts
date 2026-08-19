/**
 * Reading a KIVO system Room post back into the match event it announces.
 *
 * `insertSystemEventPost` (src/lib/football/match-room-system-posts.ts) writes
 * exactly two shapes, from real synced fixture events and nothing else:
 *
 *     ⚽ GOAL — Bukayo Saka (Arsenal), 67'
 *     🟥 RED CARD — Casemiro (Man Utd), 45+2'
 *
 * In a live Match Room those are not chat. A goal is the thing everybody in
 * the room is reacting to, and rendering it as one more grey message with an
 * avatar beside it is the single clearest way a football product can look like
 * a generic timeline. Parsed back into its parts, the same row becomes a
 * scoreboard-style event line: the minute where a minute belongs, the scorer
 * where the scorer belongs.
 *
 * NOTHING IS INVENTED HERE. Every field returned is a substring of a body that
 * KIVO's own sync wrote from a provider event. A body that does not match —
 * because the format changed, or because it is something this parser has never
 * seen — returns null, and the caller renders the raw text. A parser that
 * guessed would be a parser that eventually attributes a goal to the wrong
 * player, which is the worst thing this file could do.
 */

export type RoomEvent = {
  kind: "goal" | "red-card";
  /** "67" or "45+2", exactly as the sync wrote it. Never re-derived from a
   * timestamp — a post's wall-clock age is not a match minute, and half-time
   * alone makes that difference fifteen minutes wide. */
  minute: string;
  playerName: string;
  teamName: string;
};

/**
 * Anchored at both ends, with the team captured as "no brackets inside" so a
 * player whose name contains brackets cannot shift the team by one field. The
 * minute allows the `45+2` stoppage form the writer produces.
 */
const SYSTEM_EVENT_PATTERN =
  /^(?:⚽|🟥)\s(GOAL|RED CARD)\s—\s(.+?)\s\(([^()]+)\),\s(\d{1,3}(?:\+\d{1,2})?)'$/u;

export function parseRoomEventPost(body: string): RoomEvent | null {
  const match = SYSTEM_EVENT_PATTERN.exec(body.trim());
  if (!match) return null;
  const [, label, playerName, teamName, minute] = match;
  return {
    kind: label === "GOAL" ? "goal" : "red-card",
    minute,
    playerName,
    teamName,
  };
}
