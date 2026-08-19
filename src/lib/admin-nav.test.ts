import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_NAV, ADMIN_NAV_GROUPS, isAdminNavItemActive } from "./admin-nav";

/**
 * The admin nav's failure mode is silent: a link to a route that does not exist
 * renders identically to one that does, right up until somebody taps it and
 * gets the 404. Splitting Data Health into four routes made that a live risk,
 * so the nav is checked against the filesystem rather than against itself.
 */
describe("admin nav", () => {
  it("points every item at a route that actually exists", () => {
    for (const item of ADMIN_NAV) {
      const segment = item.href.replace(/^\//, "");
      const dir = join(process.cwd(), "src/app", segment);
      expect(
        existsSync(join(dir, "page.tsx")),
        `${item.href} has no page.tsx — the nav links to a 404`,
      ).toBe(true);
    }
  });

  it("lists every href exactly once", () => {
    const hrefs = ADMIN_NAV.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("gives every item a description, because the mobile drawer renders one", () => {
    for (const item of ADMIN_NAV) {
      expect(item.description.length, `${item.href} has no description`).toBeGreaterThan(0);
    }
  });

  it("keeps the groups non-empty and uniquely identified", () => {
    const ids = ADMIN_NAV_GROUPS.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const group of ADMIN_NAV_GROUPS) {
      expect(group.items.length, `${group.id} is an empty group`).toBeGreaterThan(0);
    }
  });

  /**
   * The reason `exact` exists. `/admin` is a prefix of every admin route and
   * `/admin/data-health` is a prefix of its three children, so a plain
   * startsWith check highlights two nav items at once — which is how the
   * previous flat nav had to special-case the root by hand.
   */
  it("highlights exactly one item for a nested football route", () => {
    const active = ADMIN_NAV.filter((item) => isAdminNavItemActive("/admin/data-health/coverage", item));
    expect(active.map((item) => item.href)).toEqual(["/admin/data-health/coverage"]);
  });

  it("highlights the overview only on the overview itself", () => {
    const overview = ADMIN_NAV.find((item) => item.href === "/admin")!;
    expect(isAdminNavItemActive("/admin", overview)).toBe(true);
    expect(isAdminNavItemActive("/admin/users", overview)).toBe(false);
  });

  it("highlights a section from one of its own sub-paths", () => {
    const moderation = ADMIN_NAV.find((item) => item.href === "/admin/moderation")!;
    expect(isAdminNavItemActive("/admin/moderation/anything", moderation)).toBe(true);
  });

  it("highlights nothing when there is no pathname yet", () => {
    expect(ADMIN_NAV.some((item) => isAdminNavItemActive(null, item))).toBe(false);
  });
});
