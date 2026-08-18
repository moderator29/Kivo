import {
  AtSign,
  Bell,
  CircleUserRound,
  Database,
  LifeBuoy,
  Palette,
  Shield,
  ShieldAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

export type SettingsSection = {
  id: string;
  label: string;
  /** One line, present tense, naming the actual controls behind the row — the
   * thing that makes a list of rows navigable without opening each one. */
  description: string;
  href: string;
  icon: LucideIcon;
  /** Rendered apart from the main list, under its own heading. */
  group: "account" | "app" | "data" | "danger";
};

/**
 * Settings, as a map instead of a scroll.
 *
 * `/settings` was one column of nine independent panels of equal visual
 * weight — the founder's own example of the structural problem across this
 * app, and KIVO_NEXT_GEN KN-50. A jump-link row was added first, which helped
 * and did not fix it: the page was still one page, so every control was still
 * loaded, still scrollable past, and still impossible to link a person to
 * without also handing them eight other things.
 *
 * Each entry below is now a real route with its own header, its own back
 * affordance and its own URL. This file is the single source for both the hub
 * that lists them and each page's own title/description, so a row and the page
 * it opens can never describe themselves differently.
 */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "account",
    label: "Account",
    description: "Email, username, bio and country.",
    href: "/settings/account",
    icon: AtSign,
    group: "account",
  },
  {
    id: "clubs",
    label: "Your clubs",
    description: "The club you support, and the one you never will.",
    href: "/settings/clubs",
    icon: Shield,
    group: "account",
  },
  {
    id: "avatar",
    label: "Avatar",
    description: "Pick the face KIVO shows next to your posts.",
    href: "/settings/avatar",
    icon: CircleUserRound,
    group: "account",
  },
  {
    id: "appearance",
    label: "Appearance & time",
    description: "Light or dark, and the timezone every kickoff is shown in.",
    href: "/settings/appearance",
    icon: Palette,
    group: "app",
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "What KIVO tells you about, and which clubs it stays quiet on.",
    href: "/settings/notifications",
    icon: Bell,
    group: "app",
  },
  {
    id: "privacy",
    label: "Privacy & security",
    description: "Who can see your activity, and where you're signed in.",
    href: "/settings/privacy",
    icon: ShieldAlert,
    group: "app",
  },
  {
    id: "data",
    label: "Your data",
    description: "Download everything KIVO holds about you.",
    href: "/settings/data",
    icon: Database,
    group: "data",
  },
  {
    id: "help",
    label: "Help & feedback",
    description: "Report a bug, flag wrong football data, or say anything else.",
    href: "/settings/help",
    icon: LifeBuoy,
    group: "data",
  },
  {
    id: "danger",
    label: "Delete account",
    description: "Permanently remove your account and everything in it.",
    href: "/settings/delete-account",
    icon: TriangleAlert,
    group: "danger",
  },
];

export const SETTINGS_GROUPS: { id: SettingsSection["group"]; label: string }[] = [
  { id: "account", label: "You" },
  { id: "app", label: "App" },
  { id: "data", label: "Data & help" },
  { id: "danger", label: "Danger zone" },
];

export function getSettingsSection(id: string): SettingsSection {
  const section = SETTINGS_SECTIONS.find((s) => s.id === id);
  if (!section) throw new Error(`getSettingsSection: no SETTINGS_SECTIONS entry with id "${id}"`);
  return section;
}
