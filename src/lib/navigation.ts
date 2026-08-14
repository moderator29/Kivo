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
  comingSoonDescription?: string;
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
    status: "coming-soon",
    comingSoonDescription:
      "Real-time scores, minute-by-minute events and live filters across every competition KIVO covers.",
    comingSoonImage: "/assets/icons/navigation/live-scores.webp",
  },
  {
    id: "matches",
    label: "Matches",
    href: "/matches",
    icon: CalendarDays,
    status: "coming-soon",
    comingSoonDescription: "Fixtures, calendars and results once a football data provider is connected.",
    comingSoonImage: "/assets/icons/navigation/matches.webp",
  },
  {
    id: "discover",
    label: "Discover",
    href: "/discover",
    icon: Compass,
    status: "coming-soon",
    comingSoonDescription: "Leagues, clubs, players and AI-curated football discovery in one place.",
  },
  { id: "social", label: "Social", href: "/social", icon: Users, status: "live" },
  {
    id: "fantasy",
    label: "Fantasy",
    href: "/fantasy",
    icon: Trophy,
    status: "coming-soon",
    comingSoonDescription:
      "Build your squad, set a captain and compete in private leagues once a gameweek data source is live.",
    comingSoonImage: "/assets/icons/fantasy-rewards/fantasy.webp",
  },
  {
    id: "predictions",
    label: "Predictions",
    href: "/predictions",
    icon: Target,
    status: "coming-soon",
    comingSoonDescription: "Pre-match predictions, streaks and leaderboards, resolved from verified results.",
    comingSoonImage: "/assets/icons/navigation/predictions.webp",
  },
  {
    id: "transfers",
    label: "Transfers",
    href: "/transfers",
    icon: ArrowLeftRight,
    status: "coming-soon",
    comingSoonDescription: "Confirmed moves, reports and rumours, clearly labelled by confidence.",
    comingSoonImage: "/assets/icons/navigation/transfers.webp",
  },
  {
    id: "news",
    label: "News",
    href: "/news",
    icon: Newspaper,
    status: "coming-soon",
    comingSoonDescription: "Source-attributed football news and AI-summarised briefings.",
    comingSoonImage: "/assets/icons/navigation/news.webp",
  },
  {
    id: "teams",
    label: "Teams",
    href: "/teams",
    icon: Shield,
    status: "coming-soon",
    comingSoonDescription: "Club and national team hubs with squads, form, fixtures and community.",
    comingSoonImage: "/assets/icons/navigation/teams.webp",
  },
  {
    id: "players",
    label: "Players",
    href: "/players",
    icon: UserRound,
    status: "coming-soon",
    comingSoonDescription: "Player profiles, performance history and AI-assisted comparisons.",
    comingSoonImage: "/assets/icons/navigation/players.webp",
  },
  {
    id: "leagues",
    label: "Leagues",
    href: "/leagues",
    icon: ListOrdered,
    status: "coming-soon",
    comingSoonDescription: "Standings, fixtures and leaders for every competition KIVO tracks.",
    comingSoonImage: "/assets/icons/navigation/leagues.webp",
  },
  {
    id: "ai",
    label: "AI Copilot",
    href: "/ai",
    icon: Sparkles,
    status: "coming-soon",
    comingSoonDescription:
      "Ask anything about a match, player or team and get answers grounded in verified KIVO data.",
    comingSoonImage: "/assets/icons/navigation/ai-copilot.webp",
  },
  {
    id: "rewards",
    label: "Rewards",
    href: "/rewards",
    icon: Award,
    status: "coming-soon",
    comingSoonDescription: "XP, badges and streaks earned across predictions, fantasy and the community.",
    comingSoonImage: "/assets/icons/fantasy-rewards/rewards.webp",
  },
  { id: "profile", label: "Profile", href: "/profile", icon: CircleUserRound, status: "live" },
];
