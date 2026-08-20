import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The one property `footballDataGate` exists to hold, asserted against the
 * source of the four pages rather than against a description of them.
 *
 * The tempting refactor here is to delete these per-page gates and keep only
 * the one in `layout.tsx`. It is wrong, and the framework says so:
 * `node_modules/next/dist/docs/01-app/02-guides/authentication.md` — "a layout
 * that hides or swaps them does not stop them from running or from appearing in
 * the RSC Payload", and layouts "don't re-render on navigation" under Partial
 * Rendering. So a layout returning a lock screen does not stop these pages
 * executing, and every one of them opens by querying an RLS-gated table.
 * RECOMMENDATIONS A3: a check the viewer cannot read must not be run, because
 * an RLS-filtered zero renders as "all clear".
 *
 * A future author who deletes a gate for tidiness gets a failing test with the
 * reason attached, instead of a page that silently reports an empty queue to a
 * role that simply cannot see it.
 */

const PAGES = ["provider", "coverage", "pipeline", "integrity"] as const;

/** Anything that would reach the database. If one of these appears before the
 *  gate call, the page reads before it checks. */
const READ_MARKERS = ["createServerSupabaseClient(", "createServiceRoleSupabaseClient(", "getActiveProviderStatus("];

describe("football data role gate", () => {
  it.each(PAGES)("%s calls the shared gate and returns before reading anything", (page) => {
    const source = readFileSync(join(process.cwd(), "src/app/admin/football", page, "page.tsx"), "utf8");

    const gateAt = source.indexOf("await footballDataGate(");
    expect(gateAt, `${page}/page.tsx does not call footballDataGate()`).toBeGreaterThan(-1);
    expect(source, `${page}/page.tsx calls the gate but does not act on it`).toContain("if (denied) return null;");

    const returnAt = source.indexOf("if (denied) return null;");
    for (const marker of READ_MARKERS) {
      const readAt = source.indexOf(marker);
      if (readAt === -1) continue;
      expect(readAt, `${page}/page.tsx reaches ${marker} before the gate returns`).toBeGreaterThan(returnAt);
    }
  });

  it("keeps the layout's gate too, so the denial is explained once", () => {
    const source = readFileSync(join(process.cwd(), "src/app/admin/football/layout.tsx"), "utf8");
    expect(source).toContain("await footballDataGate()");
    expect(source).toContain("if (denied) return denied;");
  });

  it("states the reason in exactly one place", () => {
    const access = readFileSync(join(process.cwd(), "src/app/admin/football/access.tsx"), "utf8");
    expect(access).toContain("FOOTBALL_ACCESS_REASON");
    for (const page of PAGES) {
      const source = readFileSync(join(process.cwd(), "src/app/admin/football", page, "page.tsx"), "utf8");
      expect(
        source,
        `${page}/page.tsx hand-rolls its own lock screen again — the four bespoke ones are what A9.2 removed`,
      ).not.toContain("AdminAccessNotice");
    }
  });
});
