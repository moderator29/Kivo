import { describe, expect, it, vi } from "vitest";
import { chunkTeamIds, fetchFixturesForTeams, TEAM_ID_CHUNK_SIZE } from "./fixtures-by-team";

type Row = { id: string; kickoff_at: string };

function id(n: number) {
  return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
}

describe("chunkTeamIds", () => {
  it("de-duplicates before chunking", () => {
    expect(chunkTeamIds(["a", "b", "a", "b", "c"], 2)).toEqual([["a", "b"], ["c"]]);
  });

  it("returns no chunks for an empty list, so no query is issued at all", () => {
    expect(chunkTeamIds([])).toEqual([]);
  });

  it("keeps every chunk within the size that bounds the URL", () => {
    const ids = Array.from({ length: 137 }, (_, i) => id(i));
    const chunks = chunkTeamIds(ids);
    expect(chunks.flat()).toHaveLength(137);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(TEAM_ID_CHUNK_SIZE);
  });
});

describe("fetchFixturesForTeams", () => {
  it("issues no query when the viewer follows nobody", async () => {
    const query = vi.fn();
    expect(await fetchFixturesForTeams([], 10, query)).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("queries both sides of every chunk", async () => {
    const calls: [string, number][] = [];
    const ids = Array.from({ length: 65 }, (_, i) => id(i));
    await fetchFixturesForTeams(ids, 10, async (column, chunk) => {
      calls.push([column, chunk.length]);
      return { data: [] };
    });
    // 65 ids at 30 per chunk = 3 chunks, home + away each.
    expect(calls).toHaveLength(6);
    expect(calls.filter(([c]) => c === "home_team_id")).toHaveLength(3);
    expect(calls.map(([, n]) => n)).toEqual([30, 30, 30, 30, 5, 5]);
  });

  it("de-duplicates a fixture returned by both the home and away query", async () => {
    const shared: Row = { id: "f1", kickoff_at: "2026-08-18T12:00:00Z" };
    const out = await fetchFixturesForTeams(["a", "b"], 10, async () => ({ data: [shared] }));
    expect(out).toEqual([shared]);
  });

  it("returns the globally earliest fixtures across chunks, in kickoff order", async () => {
    const byColumn: Record<string, Row[]> = {
      home_team_id: [
        { id: "c", kickoff_at: "2026-08-18T15:00:00Z" },
        { id: "a", kickoff_at: "2026-08-18T11:00:00Z" },
      ],
      away_team_id: [
        { id: "b", kickoff_at: "2026-08-18T13:00:00Z" },
        { id: "d", kickoff_at: "2026-08-18T17:00:00Z" },
      ],
    };
    const out = await fetchFixturesForTeams(["a", "b"], 3, async (column) => ({ data: byColumn[column] }));
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("tolerates a null data payload from any sub-query", async () => {
    const out = await fetchFixturesForTeams(["a"], 5, async (column) =>
      column === "home_team_id" ? { data: null } : { data: [{ id: "x", kickoff_at: "2026-08-18T10:00:00Z" }] },
    );
    expect(out.map((r) => r.id)).toEqual(["x"]);
  });
});
