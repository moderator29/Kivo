import { Shield, UserRound, Trophy, ClipboardList, MapPin, type LucideIcon } from "lucide-react";
import type { SearchResultType } from "@/app/(app)/search-actions";

/**
 * One place that says what each search result type is called, which icon
 * stands for it, and where it goes. Two surfaces render `SearchResult`s now —
 * the ⌘K command palette and the /search page — and a type that renders as
 * "Managers" in one and "Manager" in the other, or links somewhere different,
 * is the exact kind of drift a second surface introduces silently. Adding a
 * type to `SearchResultType` without adding it here is a compile error, not a
 * blank row at runtime.
 */
export const SEARCH_TYPE_META: Record<
  SearchResultType,
  { icon: LucideIcon; group: string; singular: string; href: string }
> = {
  team: { icon: Shield, group: "Teams", singular: "Team", href: "/teams" },
  player: { icon: UserRound, group: "Players", singular: "Player", href: "/players" },
  competition: { icon: Trophy, group: "Competitions", singular: "Competition", href: "/leagues" },
  manager: { icon: ClipboardList, group: "Managers", singular: "Manager", href: "/managers" },
  venue: { icon: MapPin, group: "Venues", singular: "Venue", href: "/venues" },
};

/** Group order on the /search page — most-searched-for entity first, rather
 * than whatever order searchPlatform happened to push results in. */
export const SEARCH_TYPE_ORDER: SearchResultType[] = ["team", "player", "competition", "manager", "venue"];

export function searchResultHref(type: SearchResultType, id: string): string {
  return `${SEARCH_TYPE_META[type].href}/${id}`;
}
