import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, ShieldAlert, LifeBuoy, Users, Database, Palette } from "lucide-react";

/**
 * The /admin section's own navigation.
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
 * be passed wrongly.
 */
export type AdminNavItem = { href: string; label: string; icon: LucideIcon };

export const ADMIN_NAV: AdminNavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/moderation", label: "Moderation", icon: ShieldAlert },
  // KN-118. Above Users deliberately: KIVO has no password and no social
  // login, so for anyone whose sign-in code never arrives this queue is the
  // only route back into their account. It is time-sensitive in a way the
  // others are not, and nothing notifies anybody that a request has landed —
  // somebody opening this page IS the on-call rota until KIVO has transactional
  // email of its own (docs/ACCOUNT_RECOVERY.md).
  { href: "/admin/support", label: "Support", icon: LifeBuoy },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/data-health", label: "Data health", icon: Database },
  // KN-63. An internal reference, not an operational tool — last in the list
  // for that reason, but in the list, because a design system nobody can find
  // is the same as no design system.
  { href: "/admin/design", label: "Design system", icon: Palette },
];
