"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { FlaskConical } from "lucide-react";

/**
 * Persistent, impossible-to-miss admin-only banner shown on every page while
 * preview mode is active (see src/lib/preview-mode.ts). Rendered only when
 * the server has already confirmed BOTH admin + opt-in cookie — this
 * component itself does not decide whether to render, it's told to by
 * src/components/layout/app-shell.tsx.
 *
 * Fixed (not sticky) so it can never scroll out of view — a screenshot taken
 * at any scroll position on any page still shows it. AppShell adds matching
 * top padding to the page so nothing sits underneath it.
 */
export function PreviewModeBanner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const currentPath = query ? `${pathname}?${query}` : pathname;
  const exitHref = `/admin/preview-mode?on=0&redirect=${encodeURIComponent(currentPath)}`;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[60] flex h-9 items-center justify-center gap-2 bg-amber-400 px-4 text-center text-xs font-bold uppercase tracking-wide text-black shadow-raise"
    >
      <FlaskConical className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} aria-hidden="true" />
      <span>Preview mode — sample data, not real. Visible to admins only.</span>
      <Link href={exitHref} className="ml-2 shrink-0 underline underline-offset-2 hover:no-underline">
        Exit preview
      </Link>
    </div>
  );
}
