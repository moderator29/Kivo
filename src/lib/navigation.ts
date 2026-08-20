import type { LucideIcon } from "lucide-react";
import {
  Home,
  Radio,
  CalendarDays,
  Compass,
  Users,
  Trophy,
  Target,
  ArrowLeftRight,
  Newspaper,
  Shield,
  UserRound,
  ListOrdered,
  Sparkles,
  Award,
  CircleUserRound,
  Settings,
  ShieldCheck,
  Search,
  Bell,
  LifeBuoy,
  ClipboardList,
  MapPin,
  Video,
  Bookmark,
  Eye,
} from "lucide-react";

export type NavStatus = "live" | "coming-soon";

/** Given how many surfaces are still under active build, this is judged by
 * eye rather than derived from an already-thin dataset: which four items
 * plus a "More" sheet make the best mobile thumb-reach bar right now. */
export function isActiveRoute(pathname: string | null, href: string) {
  return pathname === href || (pathname?.startsWith(`${href}/`) ?? false);
}

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  status: NavStatus;
  /**
   * What a *built* surface says when its table is genuinely empty.
   *
   * Separate from `comingSoonDescription` on purpose, and the separation is
   * the point rather than tidiness. Every built page — /live, /matches,
   * /teams, /players, /leagues, /discover, /predictions, /transfers — used to
   * read its empty-state copy out of a field called `comingSoonDescription`.
   * The rendered sentence was fine; the model behind it said that "we have not
   * synced this yet" and "we have not built this yet" are the same fact, and a
   * model that cannot tell them apart is one edit away from a page that tells
   * a user a working feature is unreleased.
   *
   * Only `status: "coming-soon"` items carry the coming-soon fields now, and
   * only built ones carry this. See src/components/ui/no-data-yet.tsx and
   * src/components/ui/coming-soon.tsx, which are already two different screens
   * for exactly this reason.
   */
  emptyDescription?: string;
  comingSoonDescription?: string;
  /** The concrete capabilities the feature will ship with — rendered as the
   * body of its Coming Soon page. Kept here rather than in the page module so
   * every honest gap in the product is described in one file, next to the nav
   * entry that leads to it. */
  comingSoonDetails?: string[];
  /** The nameable thing standing in the way. Every Coming Soon in KIVO is
   * blocked on something real: a licence, a rights deal, an API key. Saying
   * which is what separates an honest gap from a vague promise. */
  comingSoonBlocker?: string;
  /** 3D icon from the sliced asset library, shown on the full Coming Soon page.
   * Compact nav rows always use the vector `icon` above, per the icon-system rule:
   * 3D art for feature discovery / empty states, vector for compact controls.
   * Only set where a manifest icon unambiguously matches — no forced/guessed mapping. */
  comingSoonImage?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Home", href: "/home", icon: Home, status: "live" },
  {
    id: "live",
    label: "Live",
    href: "/live",
    icon: Radio,
    status: "live",
    // Reached only when KIVO holds no fixtures at all, for any date — /live
    // checks which of the two empty states it is in and writes the "quiet day"
    // sentence itself.
    emptyDescription: "No match is in play right now — live scores appear here the moment one kicks off.",
  },
  {
    id: "matches",
    label: "Matches",
    href: "/matches",
    icon: CalendarDays,
    status: "live",
    emptyDescription: "No fixtures to show yet. Check back soon.",
  },
  {
    id: "discover",
    label: "Discover",
    href: "/discover",
    icon: Compass,
    status: "live",
    emptyDescription: "Nothing to explore just yet. Check back soon.",
  },
  { id: "social", label: "Social", href: "/social", icon: Users, status: "live" },
  // Search stopped being a field wedged into the top bar and became a real
  // destination (src/app/(app)/search/page.tsx), so it needs a real nav entry
  // in both shells rather than only existing as a ⌘K shortcut a phone can
  // never press.
  { id: "search", label: "Search", href: "/search", icon: Search, status: "live" },
  { id: "fantasy", label: "Fantasy", href: "/fantasy", icon: Trophy, status: "live" },
  {
    id: "predictions",
    label: "Predictions",
    href: "/predictions",
    icon: Target,
    status: "live",
    emptyDescription: "No upcoming matches to predict on yet.",
  },
  {
    id: "transfers",
    label: "Transfers",
    href: "/transfers",
    icon: ArrowLeftRight,
    status: "live",
    emptyDescription: "No transfers to show yet.",
  },
  {
    id: "news",
    label: "News",
    href: "/news",
    icon: Newspaper,
    status: "coming-soon",
    comingSoonDescription:
      "Football news, every item attributed to the outlet that published it, filtered to the clubs and players you follow.",
    comingSoonDetails: [
      "A headline feed scoped to your followed clubs, players and competitions — not a general sports wire.",
      "Every item carries its publisher, its timestamp and a link out. KIVO never republishes an article as its own.",
      "AI briefings that summarise what you missed, clearly separated from the source text they summarise.",
      "News attached to the match it is about, so a Match Room and its coverage sit in one place.",
    ],
    comingSoonBlocker:
      "News needs a licence. What KIVO carries today is football itself — fixtures, events and squads — not journalism, and lifting headlines from publishers who have not agreed to it is not something this product will do. This turns on the day a licence is in place, not before.",
    comingSoonImage: "/assets/icons/navigation/news.webp",
  },
  // Rights, not effort. Named in the directive, genuinely unbuildable today,
  // and therefore in the nav as an honest Coming Soon rather than absent — a
  // missing feature a person was promised is worse than a described one.
  {
    id: "highlights",
    label: "Highlights",
    href: "/highlights",
    icon: Video,
    status: "coming-soon",
    comingSoonDescription:
      "Goals and key moments as video, attached to the match they came from and to the moment on its timeline.",
    comingSoonDetails: [
      "Every goal, red card and penalty as a clip, opened straight from the Match Centre timeline.",
      "A per-match reel for anything you missed, and a per-player one for anyone you follow.",
      "Clips carry the rights holder's own attribution and player, exactly as licensed — never a re-host.",
      "Shareable the same way a KIVO card is, within whatever the licence allows.",
    ],
    comingSoonBlocker:
      "Match video is licensed per competition, per territory, by the rights holder, and it is not something KIVO can host on its own. Until KIVO holds those rights for a competition, there is no lawful clip to show, and a highlights tab full of links to someone else's uploads is not a feature.",
    comingSoonImage: "/assets/icons/match-centre/highlights.webp",
  },
  {
    id: "teams",
    label: "Teams",
    href: "/teams",
    icon: Shield,
    status: "live",
    emptyDescription: "No clubs to show yet. Check back soon.",
  },
  {
    id: "players",
    label: "Players",
    href: "/players",
    icon: UserRound,
    status: "live",
    emptyDescription: "No players to show yet. Check back soon.",
  },
  {
    id: "leagues",
    label: "Leagues",
    href: "/leagues",
    icon: ListOrdered,
    status: "live",
    emptyDescription: "No competitions to show yet. Check back soon.",
  },
  // KN-30: both of these routes were fully built — list page, detail page,
  // loading skeleton — and reachable from nowhere. Grepping every href in src/
  // returned only `/managers/[id]` and `/venues/[id]` links, from team and
  // match pages and from the lists themselves; neither list appeared in
  // NAV_ITEMS, in any nav group, or in the body of any page. A user could
  // arrive at a manager's page by tapping through a squad and had no way to
  // find the list they were on. Same class as item 267's `/saved` finding,
  // which named only `/saved`.
  {
    id: "managers",
    label: "Managers",
    href: "/managers",
    icon: ClipboardList,
    status: "live",
    emptyDescription: "No managers to show yet. Check back soon.",
  },
  {
    id: "venues",
    label: "Venues",
    href: "/venues",
    icon: MapPin,
    status: "live",
    emptyDescription: "No venues to show yet. Check back soon.",
  },
  {
    id: "ai",
    label: "AI Copilot",
    href: "/ai",
    icon: Sparkles,
    status: "coming-soon",
    comingSoonDescription:
      "Ask anything about a match, player or team and get answers grounded in verified KIVO data.",
    comingSoonDetails: [
      "Answers built from the football KIVO actually holds, with the model explaining it rather than inventing it.",
      "Fact, KIVO-calculated insight and uncertainty labelled separately on every answer.",
      "Ask from any match, team or player page and arrive with that context already loaded.",
    ],
    comingSoonBlocker:
      "The Copilot is finished and waiting on nothing but being switched on. When it is, it appears here — there is no waiting list and nothing for you to do.",
    comingSoonImage: "/assets/icons/navigation/ai-copilot.webp",
  },
  { id: "rewards", label: "Rewards", href: "/rewards", icon: Award, status: "live" },
  { id: "settings", label: "Settings", href: "/settings", icon: Settings, status: "live" },
  { id: "profile", label: "Profile", href: "/profile", icon: CircleUserRound, status: "live" },
  // Both are real, already-built routes that the nav never listed: /notifications
  // was reachable only by opening the bell and clicking through, and /support
  // (migration 0055) only from the sign-in screen and the marketing footer —
  // the two places a signed-in user never looks. They sit in the nav shells'
  // "Shortcuts" group.
  { id: "notifications", label: "Notifications", href: "/notifications", icon: Bell, status: "live" },
  // Both are real, built routes that the nav never listed. `/saved` was
  // reachable only by noticing a stat tile on your own profile, and
  // `/transparency` only from the signed-out marketing page and a few empty
  // states — so the one page that explains what KIVO does and does not know
  // was unreachable from inside the product it explains. Same class of finding
  // as /managers and /venues before KN-30.
  { id: "saved", label: "Saved", href: "/saved", icon: Bookmark, status: "live" },
  { id: "transparency", label: "What KIVO knows", href: "/transparency", icon: Eye, status: "live" },
  { id: "support", label: "Help & support", href: "/support", icon: LifeBuoy, status: "live" },
];

/**
 * Not part of NAV_ITEMS: every entry there is guest-viewable and enumerated
 * generically by the sidebar/mobile nav, but this one destination is gated on
 * `hasAdminAccess(profile.role)`, not on `status`/coming-soon. desktop-sidebar.tsx
 * and mobile-bottom-nav.tsx render it themselves behind an `isAdmin` prop
 * computed server-side in (app)/layout.tsx. RECOMMENDATIONS.md item 134.
 */
export const ADMIN_NAV_ITEM: NavItem = {
  id: "admin",
  label: "Admin",
  href: "/admin",
  icon: ShieldCheck,
  status: "live",
};

/**
 * Looks up a nav item by id, throwing a clear, named error immediately if
 * the id doesn't exist. Every top-level page module resolves its own nav
 * entry once at module scope (`const item = getNavItem("teams")`) purely to
 * read its label/icon/coming-soon copy — a typo'd id used to silently
 * produce `undefined` via `NAV_ITEMS.find(...)!`, surfacing later as an
 * opaque `Cannot read properties of undefined (reading 'icon')` crash far
 * from the actual mistake. This fails at the source instead.
 */
export function getNavItem(id: string): NavItem {
  const item = NAV_ITEMS.find((navItem) => navItem.id === id);
  if (!item) {
    throw new Error(`getNavItem: no NAV_ITEMS entry with id "${id}"`);
  }
  return item;
}
