import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryFailedError, readList, readOptionalRow, readRow } from "./query-result";

// logError writes structured JSON to console.error. Silenced here so a passing
// suite is quiet, and asserted on where the logging itself is the behaviour.
let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

const ok = <T,>(data: T) => ({ data, error: null });
const failed = (message: string) => ({ data: null, error: { message } });

describe("readList", () => {
  it("returns the rows a successful query found", () => {
    expect(readList(ok([{ id: "a" }, { id: "b" }]), "teams.list")).toEqual({
      failed: false,
      rows: [{ id: "a" }, { id: "b" }],
    });
  });

  // The whole point: an empty result and a failed result must not look alike.
  it("reports a genuinely empty table as empty, not as failed", () => {
    expect(readList(ok([]), "teams.list")).toEqual({ failed: false, rows: [] });
  });

  it("reports a failed query as failed rather than as empty", () => {
    const outcome = readList(failed("connection reset"), "teams.list");
    expect(outcome.failed).toBe(true);
    expect(outcome.rows).toEqual([]);
    expect(outcome).toMatchObject({ reason: "connection reset" });
  });

  // PostgREST can return null data with no error; that is still "nothing".
  it("treats null data with no error as empty", () => {
    expect(readList({ data: null, error: null }, "teams.list")).toEqual({ failed: false, rows: [] });
  });

  it("leaves a structured trace behind, so an operator can find what a user saw", () => {
    readList(failed("statement timeout"), "teams.list");
    expect(consoleError).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(consoleError.mock.calls[0][0] as string);
    expect(entry.context).toBe("query.teams.list");
    expect(entry.errorName).toBe("QueryFailedError");
    expect(entry.errorMessage).toContain("statement timeout");
  });

  it("does not log when there was nothing wrong", () => {
    readList(ok([]), "teams.list");
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("readRow", () => {
  it("returns the row when one was found", () => {
    expect(readRow(ok({ id: "a" }), "venues.detail")).toEqual({ id: "a" });
  });

  // maybeSingle() gives null data and null error for an absent row. That is a
  // real 404 and the caller is right to say so.
  it("returns null for a row that genuinely is not there", () => {
    expect(readRow({ data: null, error: null }, "venues.detail")).toBeNull();
  });

  // The defect this exists to stop: a failed read rendering "this doesn't
  // exist" about a venue that exists perfectly well.
  it("throws rather than let a failed read be reported as a 404", () => {
    expect(() => readRow(failed("JWT expired"), "venues.detail")).toThrow(QueryFailedError);
  });

  it("names where it failed and why, in the thrown error", () => {
    try {
      readRow(failed("JWT expired"), "venues.detail");
      expect.unreachable("readRow must throw on a failed query");
    } catch (error) {
      expect(error).toBeInstanceOf(QueryFailedError);
      expect((error as QueryFailedError).context).toBe("venues.detail");
      expect((error as Error).message).toContain("JWT expired");
      expect((error as Error).name).toBe("QueryFailedError");
    }
  });

  it("logs the failure before throwing, so the boundary is not the only record", () => {
    expect(() => readRow(failed("JWT expired"), "venues.detail")).toThrow();
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(JSON.parse(consoleError.mock.calls[0][0] as string).context).toBe("query.venues.detail");
  });
});

describe("readOptionalRow", () => {
  it("returns the row when one was found", () => {
    expect(readOptionalRow(ok({ name: "Anfield" }), "venues.metadata")).toEqual({ name: "Anfield" });
  });

  it("returns null for an absent row without logging anything", () => {
    expect(readOptionalRow({ data: null, error: null }, "venues.metadata")).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  // The difference from readRow, and the reason both exist: page metadata must
  // never take a page down, but the failure still has to be recorded.
  it("swallows a failure into null, but logs it", () => {
    expect(readOptionalRow(failed("connection reset"), "venues.metadata")).toBeNull();
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(JSON.parse(consoleError.mock.calls[0][0] as string).context).toBe("query.venues.metadata");
  });
});
