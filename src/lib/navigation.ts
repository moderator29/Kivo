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
    status: "live",
    comingSoonDescription: "No fixtures synced yet. An admin can trigger a sync from Data Health.",
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
  { id: "fantasy", label: "Fantasy", href: "/fantasy", icon: Trophy, status: "live" },
  {
    id: "predictions",
    label: "Predictions",
    href: "/predictions",
    icon: Target,
    status: "live",
    comingSoonDescription: "No upcoming fixtures synced yet to predict on.",
    comingSoonImage: "/assets/icons/navigation/predictions.webp",
  },
  {
    id: "transfers",
    label: "Transfers",
    href: "/transfers",
    icon: ArrowLeftRight,
    status: "live",
    comingSoonDescription: "No transfers synced yet.",
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
    status: "live",
    comingSoonDescription: "No teams synced yet. An admin can trigger a sync from Data Health.",
    comingSoonImage: "/assets/icons/navigation/teams.webp",
  },
  {
    id: "players",
    label: "Players",
    href: "/players",
    icon: UserRound,
    status: "live",
    comingSoonDescription: "No players synced yet. An admin can trigger a sync from Data Health.",
    comingSoonImage: "/assets/icons/navigation/players.webp",
  },
  {
    id: "leagues",
    label: "Leagues",
    href: "/leagues",
    icon: ListOrdered,
    status: "live",
    comingSoonDescription: "No competitions synced yet. An admin can trigger a sync from Data Health.",
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
  { id: "rewards", label: "Rewards", href: "/rewards", icon: Award, status: "live" },
  { id: "settings", label: "Settings", href: "/settings", icon: Settings, status: "live" },
  { id: "profile", label: "Profile", href: "/profile", icon: CircleUserRound, status: "live" },
];
