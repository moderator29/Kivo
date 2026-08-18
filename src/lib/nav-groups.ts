import { ADMIN_NAV_ITEM, NAV_ITEMS, type NavItem } from "./navigation";

/**
 * How the full nav set is grouped in both shells.
 *
 * Lives here rather than inside `desktop-sidebar.tsx` because the mobile nav
 * drawer renders the same grouping — when it was imported *from* the desktop
 * component, a client component that only ever runs on mobile was pulling in
 * the desktop sidebar's whole module graph to read one array. Purely a
 * presentation grouping: it doesn't touch NAV_ITEMS or routing.
 *
 * "home" is rendered standalone above these in both shells as the dashboard
 * entry point, and "profile" is the identity header in the drawer / the
 * account row in the sidebar / the fifth bottom-bar tab, so neither appears
 * below. Every other id appears in exactly one group, so the shells still
 * surface the complete nav set.
 */
export const NAV_GROUPS: { label: string; ids: string[] }[] = [
  { label: "Watch", ids: ["live", "matches", "news"] },
  { label: "Play", ids: ["fantasy", "predictions", "rewards"] },
  // KN-30 adds managers and venues here. They belong with teams/players/leagues
  // rather than anywhere else: they are the same thing — a list of football
  // entities you can browse into — and both were built, complete with loading
  // skeletons, and reachable from no navigation at all. Placed after the three
  // entity lists a fan reaches for first, so the group still reads in
  // descending order of how often it gets used.
  { label: "Explore", ids: ["discover", "teams", "players", "leagues", "managers", "venues", "transfers"] },
  { label: "Community", ids: ["social", "ai"] },
  // The second group in the founder's reference: the handful of destinations
  // that are about the account rather than about football. /notifications and
  // /support were both already built and both unreachable from the nav.
  { label: "Shortcuts", ids: ["search", "notifications", "settings", "support"] },
];

export type NavGroup = { label: string; items: NavItem[] };

/**
 * Resolves NAV_GROUPS into real nav items, optionally excluding ids that a
 * shell has already pinned somewhere else (the mobile bottom bar's four
 * primary destinations, which must not also appear inside the drawer's list).
 * Empty groups drop out rather than rendering a heading with nothing under it.
 */
export function buildNavGroups(options?: { exclude?: readonly string[]; isAdmin?: boolean }): NavGroup[] {
  const exclude = new Set(options?.exclude ?? []);
  const groups = NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.ids
      .filter((id) => !exclude.has(id))
      .map((id) => NAV_ITEMS.find((item) => item.id === id))
      .filter((item): item is NavItem => Boolean(item)),
  })).filter((group) => group.items.length > 0);

  // Item 134: /admin is never enumerated from NAV_ITEMS — it is appended here
  // only when the server has already confirmed the viewer's role grants it.
  if (options?.isAdmin) groups.push({ label: "Admin", items: [ADMIN_NAV_ITEM] });

  return groups;
}
