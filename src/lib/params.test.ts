import { describe, expect, it } from "vitest";
import { MAX_LIST_PAGES, resolveListPage } from "./params";

describe("resolveListPage", () => {
  it("defaults to the first page when the param is absent or unusable", () => {
    expect(resolveListPage(undefined)).toBe(1);
    expect(resolveListPage("")).toBe(1);
    expect(resolveListPage("banana")).toBe(1);
    expect(resolveListPage("NaN")).toBe(1);
  });

  it("reads a real page number", () => {
    expect(resolveListPage("3")).toBe(3);
    expect(resolveListPage(["4", "9"])).toBe(4);
  });

  it("never resolves below the first page", () => {
    expect(resolveListPage("0")).toBe(1);
    expect(resolveListPage("-7")).toBe(1);
  });

  it("truncates rather than rounding, so 2.9 pages is 2 pages", () => {
    expect(resolveListPage("2.9")).toBe(2);
  });

  it("clamps, so a hand-typed URL cannot ask a list for millions of rows", () => {
    expect(resolveListPage("99999")).toBe(MAX_LIST_PAGES);
    expect(resolveListPage("Infinity")).toBe(1);
  });
});
