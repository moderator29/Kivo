import { NAV_ITEMS } from "./navigation";
import { SETTINGS_SECTIONS } from "./settings-sections";

/**
 * KIVO has two kinds of screen, and they get two different amounts of chrome.
 *
 * **Tab routes** are the destinations in the bottom bar (plus /home, the
 * dashboard those tabs sit under). They keep the full shell: top bar, bottom
 * bar, sidebar. You are meant to move sideways between them.
 *
 * **Focus routes** are everything else — AI Copilot, Settings and every page
 * under it, notifications, rewards, a team page, a match, the social composer.
 * The founder opened AI Copilot, found the bottom bar and top bar still wrapped
 * around it, and called it exactly right: those are screens you went *into*,
 * and a screen you went into should be the whole screen, with one way back.
 *
 * The rule is deliberately mechanical rather than a hand-maintained list of
 * focus routes: a tab route is an *exact* match on one of the roots below, and
 * everything else is a focus route. So /matches is a tab and /matches/<id> is a
 * screen you opened from it; /social is a tab and /social/compose is a screen
 * you opened from it. A new page added anywhere in the product is a focus route
 * by default, which is the safe direction for this rule to fail in.
 *
 * Query strings never change the class — /social?filter=rivals is still the
 * Social tab.
 */
export const TAB_ROUTES = ["/home", "/live", "/matches", "/social", "/predictions", "/profile"] as const;

export function isTabRoute(pathname: string | null): boolean {
  if (!pathname) return true;
  return (TAB_ROUTES as readonly string[]).includes(normalisePath(pathname));
}

export function isFocusRoute(pathname: string | null): boolean {
  return !isTabRoute(pathname);
}

/**
 * Where a back control points when there is no in-app history to pop — a
 * deep link, a notification, a bookmark, a shared URL, a fresh tab.
 *
 * Two steps, in order:
 *
 * 1. An explicit parent, for the handful of routes whose real parent is not
 *    their URL prefix. `/saved` and `/rewards` are opened from the profile,
 *    not from `/`; `/teams`, `/players`, `/leagues`, `/transfers` and
 *    `/transparency` are the five surfaces `/discover` exists to list; a
 *    person's page at `/u/<handle>` is reached from the feed. Nothing here is
 *    invented — each entry names a page that genuinely links to the route.
 * 2. Otherwise walk the path up until a segment the product can actually name
 *    is found, so `/settings/account` goes back to Settings and
 *    `/teams/<id>/squad` still finds Teams.
 *
 * `/home` is the floor. Every route in KIVO can reach it, so no back control
 * can ever be a dead end.
 */
const EXPLICIT_BACK_PARENTS: Record<string, string> = {
  "/leagues": "/discover",
  "/teams": "/discover",
  "/players": "/discover",
  "/transfers": "/discover",
  "/transparency": "/discover",
  "/saved": "/profile",
  "/rewards": "/profile",
  "/profile/following": "/profile",
  // The public surface. /home is behind the auth gate, so a signed-out reader
  // of the terms must be sent to the landing page instead — a back control
  // that bounces them to sign-in is not a back control.
  "/about": "/",
  "/terms": "/",
  "/privacy": "/",
  "/support": "/",
  "/sign-in": "/",
  "/sign-up": "/",
};

/**
 * Parents for routes whose *first* segment is not itself a page.
 *
 * Only `/u/<handle>` qualifies today: someone else's profile is reached from
 * the feed, a comment or search, and `/u` on its own does not exist, so the
 * mechanical walk-up would skip straight to /home. Kept separate from the
 * exact-path map above on purpose — applying that map by first segment would
 * send `/teams/<id>` to Discover instead of to the Teams list it was opened
 * from.
 */
const DYNAMIC_ROOT_PARENTS: Record<string, string> = {
  "/u": "/social",
};

/**
 * Names for paths the nav and settings maps do not carry, because they are
 * real routes that no menu lists. Without `/profile/edit` here, its four
 * children (`/profile/edit/name`, `/bio`, `/username`, `/country`) skip past
 * the page that lists them and land on `/profile`, one level too far.
 */
const EXTRA_ROUTE_LABELS: Record<string, string> = {
  "/profile/edit": "Edit profile",
  "/admin": "Admin",
  "/": "KIVO",
};

export type BackTarget = { href: string; label: string };

/** Strips a trailing slash so `/settings/` and `/settings` classify alike. */
function normalisePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

export function backTargetFor(pathname: string | null): BackTarget {
  if (!pathname) return { href: "/home", label: "Home" };
  const path = normalisePath(pathname);
  const segments = path.split("/").filter(Boolean);

  // Step 1: an explicit parent for this exact route, or for its first segment
  // when the route is a dynamic child (/u/<handle>, /teams/<id>).
  const explicit =
    EXPLICIT_BACK_PARENTS[path] ??
    (segments.length > 1 ? DYNAMIC_ROOT_PARENTS[`/${segments[0]}`] : undefined);
  if (explicit && explicit !== path) {
    const label = routeLabel(explicit);
    if (label) return { href: explicit, label };
  }

  // Step 2: walk up to the nearest ancestor the product has a name for.
  for (let depth = segments.length - 1; depth >= 1; depth -= 1) {
    const candidate = `/${segments.slice(0, depth).join("/")}`;
    const label = routeLabel(candidate);
    if (label) return { href: candidate, label };
  }
  return { href: "/home", label: "Home" };
}

/** The product's own name for a path, or null if it does not have one. */
export function routeLabel(path: string): string | null {
  const navItem = NAV_ITEMS.find((item) => item.href === path);
  if (navItem) return navItem.label;
  const settingsSection = SETTINGS_SECTIONS.find((section) => section.href === path);
  if (settingsSection) return settingsSection.label;
  return EXTRA_ROUTE_LABELS[path] ?? null;
}
