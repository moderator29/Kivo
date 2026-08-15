import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { LayoutDashboard, ShieldAlert, Users, Database as DatabaseIcon } from "lucide-react";
import { getOrCreateProfile } from "@/lib/profile";
import { hasAdminAccess } from "@/lib/admin";
import { isClerkConfigured } from "@/lib/clerk";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";

// See src/app/(app)/layout.tsx for why this must be explicit rather than implied by
// the auth check alone.
export const dynamic = "force-dynamic";

const ADMIN_NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/moderation", label: "Moderation", icon: ShieldAlert },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/data-health", label: "Data health", icon: DatabaseIcon },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Resource-level auth boundary — see src/proxy.ts for why this isn't a middleware
  // matcher. Unconfigured Clerk has no session to check, so skip straight to sign-in.
  if (!isClerkConfigured()) {
    redirect("/sign-in");
  }
  await auth.protect();

  const profile = await getOrCreateProfile();

  // Server-side authorization is the real boundary — RLS backs this up at
  // the query layer, but the route itself must never rely on a client check.
  if (!profile || !hasAdminAccess(profile.role)) {
    redirect("/home");
  }

  // No `MotionConfig` here — the root layout (src/app/layout.tsx) already
  // provides one `reducedMotion="user"` for the whole tree, and that
  // setting reaches every `motion` component under it via context regardless
  // of DOM nesting depth. A second one here was redundant. RECOMMENDATIONS.md
  // item 74.
  return (
    <div className="flex min-h-screen flex-col bg-background lg:flex-row">
      <AdminMobileNav items={ADMIN_NAV} />
      <AdminSidebar items={ADMIN_NAV} />
      <main className="flex-1 px-4 py-6 lg:px-10 lg:py-8">{children}</main>
    </div>
  );
}
