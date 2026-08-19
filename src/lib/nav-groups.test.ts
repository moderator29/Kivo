import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_NAV_ITEM, NAV_ITEMS } from "./navigation";
import { NAV_GROUPS, buildNavGroups } from "./nav-groups";

/**
 * Navigation completeness, enforced rather than remembered.
 *
 * `nav-groups.ts` is a single point of failure and has already behaved like
 * one twice: `/managers` and `/venues` were fully built and reachable from no
 * navigation at all until KN-30 noticed, and `/saved` and `/transparency` were
 * in the same state until this pass. Nothing caught either, because "is every
 * built page reachable?" is a question no type checks and no page renders.
 *
 * These tests are that check. They are deliberately filesystem-aware: a nav
 * entry pointing at a route that does not exist is a 404 in production, and a
 * route that exists but appears in no group is a feature nobody can find.
 * Both are silent failures without this file.
 */

/** Rendered standalone by both shells (the dashboard entry point and the
 * account identity row), which is why neither appears in a group. */
const STANDALONE_IDS = new Set(["home", "profile"]);

/** A nav destination can live in either shell: most are inside the signed-in
 * `(app)` group, and `/support` sits at the app root because it is also
 * reachable signed-out from the sign-in screen and the marketing footer. Both
 * are checked, so the test asserts "this route exists" rather than "this route
 * exists where I assumed". */
const ROUTE_ROOTS = [join(process.cwd(), "src/app/(app)"), join(process.cwd(), "src/app")];

describe("NAV_GROUPS", () => {
  it("places every nav item in exactly one group, or standalone", () => {
    const grouped = NAV_GROUPS.flatMap((group) => group.ids);
    const seen = new Map<string, number>();
    for (const id of grouped) seen.set(id, (seen.get(id) ?? 0) + 1);

    const duplicated = [...seen.entries()].filter(([, count]) => count > 1).map(([id]) => id);
    expect(duplicated, "an id in two groups renders twice in the sidebar").toEqual([]);

    const missing = NAV_ITEMS.filter((item) => !STANDALONE_IDS.has(item.id) && !seen.has(item.id)).map(
      (item) => item.id,
    );
    expect(missing, "these nav items exist but are in no group, so nothing renders them").toEqual([]);
  });

  it("references no id that has no nav item behind it", () => {
    const known = new Set(NAV_ITEMS.map((item) => item.id));
    const dangling = NAV_GROUPS.flatMap((group) => group.ids).filter((id) => !known.has(id));
    expect(dangling, "a group listing an unknown id silently drops it").toEqual([]);
  });

  it("resolves every group to at least one real item", () => {
    for (const group of buildNavGroups()) {
      expect(group.items.length, `group "${group.label}" resolved to nothing`).toBeGreaterThan(0);
    }
  });

  it("appends admin only when the server says the viewer is one", () => {
    expect(buildNavGroups().some((group) => group.label === "Admin")).toBe(false);
    const asAdmin = buildNavGroups({ isAdmin: true });
    expect(asAdmin.at(-1)?.items).toEqual([ADMIN_NAV_ITEM]);
  });

  it("drops excluded ids without dropping the rest of their group", () => {
    const groups = buildNavGroups({ exclude: ["live"] });
    const watch = groups.find((group) => group.label === "Watch");
    expect(watch?.items.some((item) => item.id === "live")).toBe(false);
    expect(watch?.items.length).toBeGreaterThan(0);
  });
});

describe("NAV_ITEMS", () => {
  it("points every entry at a route that actually exists", () => {
    const missing = NAV_ITEMS.filter((item) => {
      const segment = item.href.replace(/^\//, "");
      return !ROUTE_ROOTS.some((root) => existsSync(join(root, segment, "page.tsx")));
    }).map((item) => `${item.id} -> ${item.href}`);

    expect(missing, "these nav entries lead to a 404").toEqual([]);
  });

  it("gives every coming-soon entry something real to say", () => {
    for (const item of NAV_ITEMS.filter((navItem) => navItem.status === "coming-soon")) {
      // A Coming Soon that only says "coming soon" is the thing the founder
      // explicitly asked not to ship. Each one has to name what it will do and
      // what is actually standing in the way.
      expect(item.comingSoonDescription, `${item.id} has no description`).toBeTruthy();
      expect(item.comingSoonDetails?.length ?? 0, `${item.id} lists nothing it will do`).toBeGreaterThan(0);
      expect(item.comingSoonBlocker, `${item.id} does not name what is blocking it`).toBeTruthy();
    }
  });

  it("uses each id exactly once", () => {
    const ids = NAV_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
