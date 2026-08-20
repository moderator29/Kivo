import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  ShieldAlert,
  LifeBuoy,
  Users,
  Palette,
  PlugZap,
  Globe2,
  Workflow,
  ShieldCheck,
  ScrollText,
  Sparkles,
} from "lucide-react";

/**
 * The /admin section's own navigation.
 *
 * ## Why this is a module and not a prop
 *
 * This list used to live in `src/app/admin/layout.tsx` — a Server Component —
 * and be handed to `AdminSidebar`/`AdminMobileNav` as a prop. Those are both
 * `"use client"`, and a lucide icon is a *function component*, which React
 * cannot serialize across the server/client boundary. Every route under
 * /admin therefore answered 500 at runtime:
 *
 *   Functions cannot be passed directly to Client Components unless you
 *   explicitly expose it by marking it with "use server".
 *   {$$typeof: ..., render: function ShieldAlert}
 *
 * The whole admin section was unreachable, and nothing caught it: `next build`
 * compiles the route fine, because the failure happens when the RSC payload is
 * serialized for a real request, not at build time. Reproduced in Chromium
 * against a running server — `/admin` and `/admin/design` both returned 500
 * with the generic error boundary.
 *
 * The fix is the pattern `src/lib/navigation.ts` already uses for the main
 * app: the list is a module the *client* components import directly, so the
 * icon never crosses the boundary. Nothing is passed as a prop, so nothing can
 * be passed wrongly. `capability` below is a plain string for the same reason —
 * the layout resolves it against the viewer's role server-side and passes an
 * array of permitted hrefs, which serializes fine.
 *
 * ## Why it is grouped
 *
 * ADMIN IA PASS 2026-08-19. Admin was a flat list of six links, one of which
 * ("Data health") had quietly become a 750-line page holding seventeen
 * unrelated panels added by four different agents in one night: provider
 * status, plan coverage, a competition picker, a club catalogue, league
 * tables, cron history, quota ledgers, prediction settlement, a club merge
 * tool. Everything was there and nothing was findable, because the page had
 * no thesis — it was ordered by the date each panel was written.
 *
 * The football half now answers four different questions, in the order an
 * operator actually asks them, and each is a route of its own:
 *
 *   1. Provider  — can KIVO talk to the provider, and what will it serve?
 *   2. Coverage  — what is KIVO pointed at, and how much of it is on file?
 *   3. Pipeline  — is the pipeline running, and is it succeeding?
 *   4. Integrity — is what arrived correct and complete, and what fixes it?
 *
 * The segment is `/admin/football` and Provider is `/admin/football/provider` —
 * four siblings, none of them the parent of the other three. It was
 * `/admin/data-health` with the other three nested under it until this pass:
 * the name was left wrong on purpose while six agents were importing server
 * actions out of that directory (RECOMMENDATIONS A2), because a better URL is
 * worth less than not moving seventeen import paths under five working trees.
 * The old URLs redirect permanently from `next.config.ts` — the founder
 * administers this from a phone and his bookmarks are not collateral.
 */

/**
 * What a viewer must be able to do to have any use for a page.
 *
 * Deliberately mirrors the predicate names in `src/lib/admin.ts` rather than
 * inventing a parallel permission vocabulary — the layout maps each one onto
 * the real check, so a role predicate changing in one place cannot leave the
 * nav advertising a page that answers with a lock screen.
 */
export type AdminCapability = "any" | "football" | "moderation" | "users" | "support" | "audit" | "platform";

export type AdminNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** One line, in staff language, shown in the mobile drawer and on the overview. */
  description: string;
  capability: AdminCapability;
  /**
   * True when this href is a prefix of its siblings'. `/admin` is, and the
   * shared `isActiveRoute()`'s startsWith check would otherwise highlight it
   * alongside whichever child is genuinely active. No football page needs it
   * any more: `/admin/football/provider` is a peer of the other three rather
   * than their parent, which is half the point of the rename above.
   */
  exact?: boolean;
};

export type AdminNavGroup = { id: string; label: string; items: AdminNavItem[] };

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    id: "operations",
    label: "Operations",
    items: [
      {
        href: "/admin",
        label: "Overview",
        icon: LayoutDashboard,
        description: "Everything that needs a decision right now, in one list.",
        capability: "any",
        exact: true,
      },
      // Under the Overview, because it is the same question one step back in
      // time: the Overview says what needs a decision now, this says which
      // decisions were already taken and by whom. `logAudit` has been writing
      // to `audit_log` from moderation, account sanctions, support triage and
      // six football actions since it was added, and until this pass nothing
      // in KIVO read a single row of it back — see /admin/audit's own header.
      {
        href: "/admin/audit",
        label: "Audit log",
        icon: ScrollText,
        description: "Every sensitive action on record: who did it, to what, and when.",
        capability: "audit",
      },
    ],
  },
  {
    id: "football-data",
    label: "Football data",
    items: [
      {
        href: "/admin/football/provider",
        label: "Provider",
        icon: PlugZap,
        description: "Connection, plan, season window, quota. Start here when something is empty.",
        capability: "football",
      },
      {
        href: "/admin/football/coverage",
        label: "Coverage",
        icon: Globe2,
        description: "Which competitions KIVO covers, and how much of each is on file.",
        capability: "football",
      },
      {
        href: "/admin/football/pipeline",
        label: "Pipeline",
        icon: Workflow,
        description: "Automation layers, the live worker, sync history and failures.",
        capability: "football",
      },
      {
        href: "/admin/football/integrity",
        label: "Integrity",
        icon: ShieldCheck,
        description: "Gaps, conflicts, scoring jobs and the repairs that close them.",
        capability: "football",
      },
    ],
  },
  {
    id: "community",
    label: "Community",
    items: [
      {
        href: "/admin/moderation",
        label: "Moderation",
        icon: ShieldAlert,
        description: "Reported posts, comments and profiles awaiting a decision.",
        capability: "moderation",
      },
      // KN-118. Above Users deliberately: KIVO has no password and no social
      // login, so for anyone whose sign-in code never arrives this queue is the
      // only route back into their account. It is time-sensitive in a way the
      // others are not, and nothing notifies anybody that a request has landed —
      // somebody opening this page IS the on-call rota until KIVO has transactional
      // email of its own (docs/ACCOUNT_RECOVERY.md).
      {
        href: "/admin/support",
        label: "Support",
        icon: LifeBuoy,
        description: "Inbound help requests, including everyone locked out of an account.",
        capability: "support",
      },
      {
        href: "/admin/users",
        label: "Users",
        icon: Users,
        description: "Accounts, roles and account-level moderation.",
        capability: "users",
      },
    ],
  },
  {
    id: "system",
    label: "System",
    items: [
      // RECOMMENDATIONS item 309 listed AI as the one domain of "platform +
      // provider + AI + social + fantasy health" with zero presence anywhere in
      // Admin. It is not football, so it does not belong in that group; it is a
      // system-level cost-and-abuse readout, so it belongs here.
      {
        href: "/admin/ai",
        label: "AI Copilot",
        icon: Sparkles,
        description: "Whether the Copilot is configured, what it is being asked, and what it is spending.",
        capability: "platform",
      },
      // KN-63. An internal reference, not an operational tool — last in the list
      // for that reason, but in the list, because a design system nobody can find
      // is the same as no design system.
      {
        href: "/admin/design",
        label: "Design system",
        icon: Palette,
        description: "The live tokens, density and motion every KIVO surface is built from.",
        capability: "any",
      },
    ],
  },
];

/** Flat view, for anything that needs to look an item up by href. */
export const ADMIN_NAV: AdminNavItem[] = ADMIN_NAV_GROUPS.flatMap((group) => group.items);

export function isAdminNavItemActive(pathname: string | null, item: AdminNavItem): boolean {
  if (!pathname) return false;
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
