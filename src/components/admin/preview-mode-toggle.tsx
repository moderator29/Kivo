"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { FlaskConical } from "lucide-react";

/**
 * Admin-only entry point into preview mode (src/lib/preview-mode.ts). Only
 * ever rendered when the caller has already confirmed isAdmin — see
 * src/components/layout/top-bar.tsx. The link target is the admin-gated
 * route handler at /admin/preview-mode, which re-checks admin access itself
 * before touching the cookie, so this button carries no authority on its
 * own — it's just a convenience link, not the actual gate.
 */
export function PreviewModeToggle({ active }: { active: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const currentPath = query ? `${pathname}?${query}` : pathname;
  const href = `/admin/preview-mode?on=${active ? "0" : "1"}&redirect=${encodeURIComponent(currentPath)}`;

  return (
    <Link
      href={href}
      title={
        active
          ? "Exit preview mode"
          : "Admin-only: preview not-yet-synced fields with clearly labeled sample data"
      }
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? "border-amber-400 bg-amber-400 text-black hover:bg-amber-300"
          : "border-hairline text-foreground-muted hover:border-amber-400/60 hover:text-amber-400"
      } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60`}
    >
      <FlaskConical className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      <span className="hidden sm:inline">{active ? "Preview ON" : "Preview"}</span>
    </Link>
  );
}
