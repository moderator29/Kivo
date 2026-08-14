import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LayoutDashboard, ShieldAlert, Users, Database as DatabaseIcon } from "lucide-react";
import { getOrCreateProfile } from "@/lib/profile";
import { hasAdminAccess } from "@/lib/admin";

const ADMIN_NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/moderation", label: "Moderation", icon: ShieldAlert },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/data-health", label: "Data health", icon: DatabaseIcon },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const profile = await getOrCreateProfile();

  // Server-side authorization is the real boundary — RLS backs this up at
  // the query layer, but the route itself must never rely on a client check.
  if (!profile || !hasAdminAccess(profile.role)) {
    redirect("/home");
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-white/5 bg-kivo-navy-deep/60 px-3 py-6 lg:flex">
        <div className="flex items-center gap-2 px-3 pb-8">
          <span className="kivo-gradient-victory h-7 w-7 rounded-lg" aria-hidden />
          <span className="text-base font-semibold tracking-tight text-foreground">KIVO Admin</span>
        </div>
        <nav className="flex flex-col gap-0.5">
          {ADMIN_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-foreground-muted transition-colors hover:bg-white/[0.04] hover:text-foreground"
            >
              <item.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto px-3 pt-6">
          <Link href="/home" className="text-xs text-foreground-subtle hover:text-foreground-muted">
            ← Back to KIVO
          </Link>
        </div>
      </aside>
      <main className="flex-1 px-4 py-8 lg:px-10">{children}</main>
    </div>
  );
}
