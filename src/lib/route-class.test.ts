import { describe, expect, it } from "vitest";
import { TAB_ROUTES, backTargetFor, isFocusRoute, isTabRoute, routeLabel } from "./route-class";

describe("isTabRoute", () => {
  it.each(TAB_ROUTES)("treats %s as a root, not a screen you went into", (route) => {
    expect(isTabRoute(route)).toBe(true);
    expect(isFocusRoute(route)).toBe(false);
  });

  it("ignores a trailing slash", () => {
    expect(isTabRoute("/matches/")).toBe(true);
  });

  it("treats a child of a tab as a focus route", () => {
    expect(isFocusRoute("/matches/abc")).toBe(true);
    expect(isFocusRoute("/social/compose")).toBe(true);
  });

  it("treats an unknown route as a focus route, which is the safe default", () => {
    expect(isFocusRoute("/something-nobody-has-built-yet")).toBe(true);
  });

  it("treats a null pathname as a root rather than drawing chrome it cannot place", () => {
    expect(isTabRoute(null)).toBe(true);
  });
});

describe("backTargetFor", () => {
  it.each([
    ["/matches/9f0", "/matches", "Matches"],
    ["/teams/9f0", "/teams", "Teams"],
    ["/players/9f0", "/players", "Players"],
    ["/leagues/9f0", "/leagues", "Leagues"],
    ["/managers/9f0", "/managers", "Managers"],
    ["/venues/9f0", "/venues", "Venues"],
    ["/players/compare", "/players", "Players"],
    ["/teams/compare", "/teams", "Teams"],
    ["/fantasy/browse", "/fantasy", "Fantasy"],
    ["/predictions/mine", "/predictions", "Predictions"],
    ["/social/compose", "/social", "Social"],
  ])("sends %s up to its own list", (path, href, label) => {
    expect(backTargetFor(path)).toEqual({ href, label });
  });

  it.each([
    "/settings/account",
    "/settings/clubs",
    "/settings/avatar",
    "/settings/appearance",
    "/settings/notifications",
    "/settings/privacy",
    "/settings/data",
    "/settings/help",
    "/settings/delete-account",
  ])("sends %s back to the settings hub", (path) => {
    expect(backTargetFor(path)).toEqual({ href: "/settings", label: "Settings" });
  });

  // The bug the mechanical walk-up had on its own: these four are opened from
  // /profile/edit, and skipping it lands the user a level past where they were.
  it.each(["/profile/edit/name", "/profile/edit/username", "/profile/edit/bio", "/profile/edit/country"])(
    "sends %s back to the page that lists it, not past it",
    (path) => {
      expect(backTargetFor(path)).toEqual({ href: "/profile/edit", label: "Edit profile" });
    },
  );

  it.each([
    ["/profile/edit", "/profile", "Profile"],
    ["/profile/avatar", "/profile", "Profile"],
    ["/profile/background", "/profile", "Profile"],
    ["/profile/club", "/profile", "Profile"],
    ["/profile/season", "/profile", "Profile"],
    ["/profile/following", "/profile", "Profile"],
    ["/saved", "/profile", "Profile"],
    ["/rewards", "/profile", "Profile"],
  ])("sends %s back to the profile it hangs off", (path, href, label) => {
    expect(backTargetFor(path)).toEqual({ href, label });
  });

  it.each(["/teams", "/players", "/leagues", "/transfers", "/transparency"])(
    "sends the %s list back to Discover, which is the page that lists it",
    (path) => {
      expect(backTargetFor(path)).toEqual({ href: "/discover", label: "Discover" });
    },
  );

  it("sends somebody else's profile back to the feed it was tapped from", () => {
    expect(backTargetFor("/u/kola")).toEqual({ href: "/social", label: "Social" });
  });

  // /teams/<id> must NOT inherit the /teams -> /discover override; it belongs
  // to the list it was opened from.
  it("does not let a list's own override leak onto that list's children", () => {
    expect(backTargetFor("/teams/9f0")).toEqual({ href: "/teams", label: "Teams" });
  });

  it.each([
    "/admin/moderation",
    "/admin/users",
    "/admin/data-health",
    "/admin/support",
    "/admin/design",
  ])("sends %s back to the admin overview", (path) => {
    expect(backTargetFor(path)).toEqual({ href: "/admin", label: "Admin" });
  });

  it("sends the admin overview itself back out into the product", () => {
    expect(backTargetFor("/admin")).toEqual({ href: "/home", label: "Home" });
  });

  // /home is behind the auth gate, so a signed-out reader of the terms must
  // land on the landing page, never on a redirect to sign-in.
  it.each(["/about", "/terms", "/privacy", "/support", "/sign-in", "/sign-up"])(
    "sends the public page %s back to the landing page",
    (path) => {
      expect(backTargetFor(path)).toEqual({ href: "/", label: "KIVO" });
    },
  );

  it.each(["/ai", "/discover", "/search", "/notifications", "/news", "/fantasy", "/settings"])(
    "falls back to Home for the top-level surface %s",
    (path) => {
      expect(backTargetFor(path)).toEqual({ href: "/home", label: "Home" });
    },
  );

  it("ignores a trailing slash", () => {
    expect(backTargetFor("/settings/account/")).toEqual({ href: "/settings", label: "Settings" });
  });

  it("never returns a dead end for a route nobody has named", () => {
    expect(backTargetFor("/nothing/here/at/all")).toEqual({ href: "/home", label: "Home" });
    expect(backTargetFor(null)).toEqual({ href: "/home", label: "Home" });
  });
});

describe("routeLabel", () => {
  it("reads the product's own name for a nav destination", () => {
    expect(routeLabel("/matches")).toBe("Matches");
  });

  it("reads the product's own name for a settings section", () => {
    expect(routeLabel("/settings/clubs")).toBe("Your clubs");
  });

  it("returns null for a path the product does not name", () => {
    expect(routeLabel("/matches/9f0")).toBeNull();
  });
});
