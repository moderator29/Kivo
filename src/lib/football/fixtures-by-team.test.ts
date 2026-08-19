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
    expect(await fetchFixturesForTeams([], 10, query)).toEqual({ failed: false, rows: [] });
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
    expect(out).toEqual({ failed: false, rows: [shared] });
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
    expect(out.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("tolerates a null data payload from any sub-query", async () => {
    const out = await fetchFixturesForTeams(["a"], 5, async (column) =>
      column === "home_team_id" ? { data: null } : { data: [{ id: "x", kickoff_at: "2026-08-18T10:00:00Z" }] },
    );
    expect(out.rows.map((r) => r.id)).toEqual(["x"]);
    // A null payload with no error is a real empty response, not a failure.
    expect(out.failed).toBe(false);
  });
});

describe("fetchFixturesForTeams ordering", () => {
  it("returns the globally latest fixtures when asked for descending order", async () => {
    const byColumn: Record<string, Row[]> = {
      home_team_id: [
        { id: "d", kickoff_at: "2026-08-18T17:00:00Z" },
        { id: "b", kickoff_at: "2026-08-18T13:00:00Z" },
      ],
      away_team_id: [
        { id: "c", kickoff_at: "2026-08-18T15:00:00Z" },
        { id: "a", kickoff_at: "2026-08-18T11:00:00Z" },
      ],
    };
    const out = await fetchFixturesForTeams(["a", "b"], 3, async (column) => ({ data: byColumn[column] }), "desc");
    expect(out.rows.map((r) => r.id)).toEqual(["d", "c", "b"]);
  });
});

/**
 * The failure case, which is why this function returns an outcome at all.
 *
 * One failed chunk out of six used to vanish into `data ?? []`, and the caller
 * got a shorter list with no way to tell it was short. A missing fixture does
 * not announce itself the way a missing list does.
 */
describe("fetchFixturesForTeams partial failure", () => {
  it("reports failure when any sub-query errors, rather than silently returning fewer", async () => {
    const ids = Array.from({ length: 35 }, (_, i) => id(i)); // 2 chunks, 4 queries
    let call = 0;
    const out = await fetchFixturesForTeams(ids, 10, async () => {
      call += 1;
      if (call === 2) return { data: null, error: { message: "connection reset" } };
      return { data: [{ id: `f${call}`, kickoff_at: "2026-08-18T12:00:00Z" }] };
    });

    expect(out.failed).toBe(true);
    // The rows that did arrive are still carried, so a caller can choose to
    // use them — but it has to choose, knowing they are incomplete.
    expect(out.rows.length).toBeGreaterThan(0);
  });

  it("is not failed when every sub-query succeeds and simply finds nothing", async () => {
    const out = await fetchFixturesForTeams(["a"], 10, async () => ({ data: [], error: null }));
    expect(out).toEqual({ failed: false, rows: [] });
  });
});
