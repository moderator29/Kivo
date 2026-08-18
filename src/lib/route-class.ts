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
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return (TAB_ROUTES as readonly string[]).includes(path);
}

export function isFocusRoute(pathname: string | null): boolean {
  return !isTabRoute(pathname);
}

/**
 * Where a focus route's back affordance points when there is no history to go
 * back to — a deep link, a notification, a bookmark, a fresh tab.
 *
 * The parent path, if the product has one; /home otherwise. The label is
 * whatever that destination actually calls itself, read from the same nav and
 * settings maps the rest of the app renders from, so a renamed section renames
 * every back button pointing at it.
 */
export function focusBackTarget(pathname: string | null): { href: string; label: string } {
  if (!pathname) return { href: "/home", label: "Home" };
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const segments = path.split("/").filter(Boolean);

  // Walk up until a path we can actually name is found, so /settings/account
  // goes back to Settings, and /teams/<id>/squad still finds /teams.
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
  return null;
}
