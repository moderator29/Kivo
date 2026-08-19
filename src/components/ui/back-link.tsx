"use client";

import type { MouseEvent } from "react";
import { useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { useCanGoBack } from "@/hooks/use-in-app-history";
import { backAccessibleLabel } from "@/lib/back-navigation";
import { backTargetFor } from "@/lib/route-class";
import { cn } from "@/lib/utils";

/**
 * KIVO's one way back. Every inner page in the product uses this control and
 * only this control — see docs/BACK_NAVIGATION.md for the route-by-route
 * survey behind that claim.
 *
 * It is a real `<Link href={fallback}>` first and a history pop second, which
 * is the whole design:
 *
 * - **It always goes somewhere.** The `href` is the parent surface, resolved
 *   from src/lib/route-class.ts. Server-rendered, so it works before hydration,
 *   with JavaScript off, and on the first paint of a shared link.
 * - **It prefers history when history is KIVO's.** With a KIVO page behind the
 *   current one, the click is intercepted and `router.back()` runs instead, so
 *   the user returns to the exact list, tab and scroll position they left.
 *   Next restores scroll on a real history pop and cannot restore it on a fresh
 *   push to the same URL, so this is a genuine difference, not a nicety.
 * - **It never leaves KIVO.** `useCanGoBack()` counts KIVO's own navigations
 *   rather than trusting `window.history.length`, which counts other people's
 *   sites too. Somebody who opened a fixture from a shared link gets the push
 *   to Matches, not a trip back to WhatsApp.
 * - **It behaves like a link, because it is one.** Cmd/Ctrl-click opens the
 *   parent in a new tab, middle-click works, the status bar shows a real URL,
 *   and the keyboard reaches it with no `tabIndex` of KIVO's own.
 *
 * The visible text names the destination; the accessible name names the
 * direction as well ("Back to Matches") — see `backAccessibleLabel`.
 */
export function BackLink({
  href,
  label,
  tone = "bar",
  className,
}: {
  /** The parent surface. Used verbatim when there is no KIVO history to pop. */
  href: string;
  /** What that destination calls itself: "Matches", "Settings", "Admin". */
  label: string;
  /**
   * `bar` sits in a page's own sticky header row and carries its own hover
   * fill. `inline` sits in the content column and is optically aligned to the
   * text edge beside it. Same control, same size, same behaviour.
   */
  tone?: "bar" | "inline";
  className?: string;
}) {
  const router = useRouter();
  const canGoBack = useCanGoBack();

  const onClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      // Anything the browser would treat as "open this somewhere else" is left
      // alone — the href is the honest answer for a new tab.
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!canGoBack) return;
      event.preventDefault();
      router.back();
    },
    [canGoBack, router],
  );

  return (
    <Link
      href={href}
      onClick={onClick}
      aria-label={backAccessibleLabel(label)}
      className={cn(
        // min-h-11 is the 44px tap target, and the one non-negotiable number on
        // a control whose whole job is being pressed in a hurry. rounded-xl is
        // the design system's control radius (src/lib/design-system.ts) — a
        // pill here would read as a chip rather than a button.
        "kivo-focus inline-flex min-h-11 max-w-full items-center gap-1 rounded-xl text-sm font-medium",
        "transition-colors duration-150 motion-reduce:transition-none",
        tone === "bar"
          ? "py-2 pl-1.5 pr-3.5 text-foreground hover:bg-surface-2"
          : "-ml-1.5 py-2 pl-1.5 pr-3 text-foreground-muted hover:text-foreground",
        // The press feedback is the only motion here, and it is opt-in for
        // anyone who has not asked for less. `<MotionConfig reducedMotion="user">`
        // in the root layout covers `motion/react` components; a CSS transform
        // is not one, so it says so itself.
        "motion-safe:active:scale-[0.97]",
        className,
      )}
    >
      <ChevronLeft className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

/**
 * A `<BackLink>` that works out its own destination from the current route.
 *
 * `backTargetFor()` (src/lib/route-class.ts) reads the parent and its label
 * from the same nav and settings maps the rest of the app renders from, so a
 * renamed section renames every back control pointing at it and no screen has
 * to hardcode a string that can drift. Use this wherever the answer is simply
 * "one level up" — which is every inner page in KIVO — and reach for the
 * explicit `<BackLink>` only where a surface genuinely needs to name a
 * destination the URL does not imply.
 *
 * It is a Client Component, so a Server Component page can render it without
 * becoming one itself.
 */
export function RouteBackLink({
  tone = "bar",
  className,
}: {
  tone?: "bar" | "inline";
  className?: string;
}) {
  const pathname = usePathname();
  const target = backTargetFor(pathname);
  return <BackLink href={target.href} label={target.label} tone={tone} className={className} />;
}
