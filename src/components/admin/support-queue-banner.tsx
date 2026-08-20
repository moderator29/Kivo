"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LifeBuoy, OctagonAlert, CircleHelp } from "lucide-react";
import type { SupportQueueSignal } from "@/lib/admin/support-signal";
import { RelativeTime } from "@/components/ui/relative-time";

/**
 * One line, on every Admin page, when somebody is waiting to get back into
 * their account.
 *
 * ## Why it is here and not only on the Overview
 *
 * `/admin` already escalates an open support request older than 24 hours to
 * critical, and it did that alone — so this deliberately does not render there.
 * An operator who opens Admin by tapping a bookmark for Users, or lands on
 * Moderation from a link, saw nothing at all — and
 * KIVO has no password and no social login, so this queue is the only route
 * back in for anyone whose sign-in code never arrived. This is the smallest
 * thing that makes that unmissable from wherever an operator actually enters.
 *
 * It is deliberately **not** dismissible. A control that hides an open lockout
 * is a control whose only function is to make the operator feel finished.
 *
 * ## What it is not
 *
 * It is not a notification. It reaches nobody who is not already looking at
 * Admin, and it is a reading taken when the layout rendered rather than a live
 * counter — see the header of `src/lib/admin/support-signal.ts` for both limits,
 * written down rather than implied.
 */
export function SupportQueueBanner({ signal }: { signal: SupportQueueSignal | null }) {
  const pathname = usePathname();

  // Nothing to say: the role cannot read the queue (in which case no query was
  // run at all), or the queue is genuinely empty.
  if (!signal || signal.status === "clear") return null;
  // Two places it would be redundant rather than useful, and redundancy is how a
  // real signal gets scrolled past. On /admin/support it would point at the
  // screen you are standing on. On /admin the Overview already derives the same
  // fact as a ranked attention item, with more detail than a banner can carry —
  // this exists for the seven pages that had nothing, not to say it twice on the
  // one page that already said it.
  if (pathname === "/admin" || pathname?.startsWith("/admin/support")) return null;

  if (signal.status === "unreadable") {
    return (
      <Link
        href="/admin/support"
        className="kivo-focusable flex min-h-11 items-center gap-2.5 rounded-2xl border border-hairline bg-surface-2 px-3.5 py-2 text-xs text-foreground-muted transition-colors hover:bg-surface-3"
      >
        <CircleHelp className="h-4 w-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} aria-hidden="true" />
        <span>
          The support queue couldn&apos;t be read, so KIVO can&apos;t say whether anyone is waiting. This is not the
          same as nobody waiting.
        </span>
      </Link>
    );
  }

  const { open, oldestIso, stale } = signal;

  return (
    <Link
      href="/admin/support"
      className={`kivo-focusable flex min-h-11 items-center gap-2.5 rounded-2xl border px-3.5 py-2 text-xs transition-colors ${
        stale
          ? "border-critical/40 bg-critical/10 text-critical hover:bg-critical/15"
          : "border-warning/40 bg-warning/10 text-warning hover:bg-warning/15"
      }`}
    >
      {stale ? (
        <OctagonAlert className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <LifeBuoy className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      )}
      <span className="min-w-0">
        <span className="font-semibold">
          {open} open support request{open === 1 ? "" : "s"}
        </span>
        {" — oldest "}
        <RelativeTime iso={oldestIso} />
        {stale
          ? ". Nothing notifies anybody when one lands, and for a user whose sign-in code never arrived this is the only route back into their account."
          : "."}
      </span>
    </Link>
  );
}
