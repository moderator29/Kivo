import { describe, expect, it } from "vitest";
import { groupPostsIntoThreads, THREAD_MAX_GAP_MS } from "@/lib/social-threads";

const BASE = Date.parse("2026-08-18T12:00:00.000Z");

function post(id: string, authorUsername: string | null, minutesAfterBase: number, isSystem = false) {
  return {
    id,
    authorUsername,
    isSystem,
    createdAt: new Date(BASE + minutesAfterBase * 60_000).toISOString(),
  };
}

describe("groupPostsIntoThreads", () => {
  it("returns one run per post when every author differs", () => {
    const runs = groupPostsIntoThreads([post("a", "tayo", 0), post("b", "ada", -1), post("c", "kunle", -2)]);
    expect(runs.map((run) => run.map((p) => p.id))).toEqual([["a"], ["b"], ["c"]]);
  });

  it("groups consecutive posts by the same author", () => {
    const runs = groupPostsIntoThreads([post("a", "tayo", 0), post("b", "tayo", -5), post("c", "ada", -6)]);
    expect(runs.map((run) => run.map((p) => p.id))).toEqual([["a", "b"], ["c"]]);
  });

  it("does not group across another author", () => {
    const runs = groupPostsIntoThreads([post("a", "tayo", 0), post("b", "ada", -1), post("c", "tayo", -2)]);
    expect(runs.map((run) => run.map((p) => p.id))).toEqual([["a"], ["b"], ["c"]]);
  });

  it("splits a run once the gap exceeds the window", () => {
    const beyond = THREAD_MAX_GAP_MS / 60_000 + 1;
    const runs = groupPostsIntoThreads([post("a", "tayo", 0), post("b", "tayo", -beyond)]);
    expect(runs.map((run) => run.map((p) => p.id))).toEqual([["a"], ["b"]]);
  });

  it("keeps a run exactly at the window boundary", () => {
    const atEdge = THREAD_MAX_GAP_MS / 60_000;
    const runs = groupPostsIntoThreads([post("a", "tayo", 0), post("b", "tayo", -atEdge)]);
    expect(runs.map((run) => run.map((p) => p.id))).toEqual([["a", "b"]]);
  });

  it("never groups an unidentifiable author", () => {
    const runs = groupPostsIntoThreads([post("a", null, 0), post("b", null, -1)]);
    expect(runs.map((run) => run.map((p) => p.id))).toEqual([["a"], ["b"]]);
  });

  it("never groups KIVO's automated match posts", () => {
    const runs = groupPostsIntoThreads([post("a", "kivo_system", 0, true), post("b", "kivo_system", -1, true)]);
    expect(runs.map((run) => run.map((p) => p.id))).toEqual([["a"], ["b"]]);
  });

  it("handles an empty feed", () => {
    expect(groupPostsIntoThreads([])).toEqual([]);
  });

  it("does not group across an unparseable timestamp", () => {
    const runs = groupPostsIntoThreads([
      { id: "a", authorUsername: "tayo", createdAt: "not a date" },
      { id: "b", authorUsername: "tayo", createdAt: new Date(BASE).toISOString() },
    ]);
    expect(runs.map((run) => run.map((p) => p.id))).toEqual([["a"], ["b"]]);
  });
});
