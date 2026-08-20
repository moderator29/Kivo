import type { SupportQueueSignal } from "@/lib/admin/support-signal";
import { cn } from "@/lib/utils";

/**
 * The Support nav item's badge, in the sidebar and in the mobile drawer.
 *
 * Not a decoration and not a count for its own sake: KIVO has no password and
 * no social login, so this queue is the only route back into an account for
 * anyone whose sign-in code never arrived. The number is a number of people
 * waiting.
 *
 * Amber while the queue is open, red once the oldest has been waiting more than
 * a day, and a "?" when the read failed — that last one matters most. A failed
 * read must never render as an absent badge, because an absent badge is
 * indistinguishable from a clear queue, and this project's recurring bug is
 * exactly that: a failed read drawn as an empty state.
 *
 * One component rather than two copies, because the two navs are separate files
 * and a badge that disagreed with itself between phone and desktop is the kind
 * of thing nobody would notice until it mattered.
 */
export function SupportBadge({ signal, className }: { signal: SupportQueueSignal | null; className?: string }) {
  // `null` is a role that cannot read the queue at all, in which case no query
  // was run (see src/lib/admin/support-signal.ts). Nothing to show either way.
  if (!signal || signal.status === "clear") return null;

  const label = signal.status === "unreadable" ? "?" : signal.open > 99 ? "99+" : String(signal.open);
  const tone =
    signal.status === "unreadable"
      ? "bg-surface-2 text-foreground-subtle"
      : signal.stale
        ? "bg-critical/15 text-critical"
        : "bg-warning/15 text-warning";

  return (
    <span
      aria-label={
        signal.status === "unreadable"
          ? "The support queue could not be read"
          : `${signal.open} open support request${signal.open === 1 ? "" : "s"}${
              signal.stale ? ", oldest waiting over a day" : ""
            }`
      }
      className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", tone, className)}
    >
      {label}
    </span>
  );
}
