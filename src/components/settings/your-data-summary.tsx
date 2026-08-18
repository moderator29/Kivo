import type { ReactNode } from "react";
import { Database } from "lucide-react";
import { LocalDateTime } from "@/components/ui/relative-time";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { formatNumber } from "@/lib/format";
import { USER_DATA_CATEGORIES, getUserDataSummary } from "@/lib/user-data";

/**
 * KIVO_NEXT_GEN KN-112: "your data" as something you can read, not only
 * something you can download.
 *
 * `/transparency` tells people what the platform does and does not know about
 * football. This is the same principle turned around: what KIVO holds about
 * *them*, category by category, counted for real. Nothing here is estimated,
 * rounded or bucketed — every number is a live count through the reader's own
 * RLS-enforced client, so it is by construction the same set of rows the export
 * below it writes out.
 *
 * Three states, kept genuinely distinct: a real count, "nothing stored yet",
 * and "couldn't read this just now". A failed count is never rendered as zero.
 * Zero means KIVO holds none of these; unreadable means KIVO does not currently
 * know. Collapsing those two would make this panel's one job — telling someone
 * the truth about their own data — the thing it got wrong.
 */
export async function YourDataSummary({ profileId, children }: { profileId: string; children: ReactNode }) {
  const supabase = createServerSupabaseClient();
  const summary = await getUserDataSummary(supabase, profileId);

  const held = USER_DATA_CATEGORIES.filter((category) => (summary.counts[category.key] ?? 0) > 0);
  const empty = USER_DATA_CATEGORIES.filter((category) => summary.counts[category.key] === 0);
  const unreadable = USER_DATA_CATEGORIES.filter((category) => summary.counts[category.key] === null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">Your data</span>
        <span className="text-xs text-foreground-subtle">
          Everything KIVO stores about you, counted right now. The download below contains all of it.
        </span>
      </div>

      <div className="kivo-glass-sharp flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl px-4 py-3">
        <span className="flex items-center gap-2 text-xs text-foreground-muted">
          <Database className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
          {summary.memberSince ? (
            <>
              On KIVO since <LocalDateTime iso={summary.memberSince} format="full" className="text-foreground" />
            </>
          ) : (
            "Account start date unavailable"
          )}
        </span>
        {summary.totalXp !== null && (
          <span className="text-xs text-foreground-muted">
            <span className="font-semibold text-foreground">{formatNumber(summary.totalXp)}</span> XP earned
          </span>
        )}
      </div>

      {held.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {held.map((category) => (
            <li key={category.key} className="kivo-glass-sharp flex flex-col gap-0.5 rounded-xl px-3 py-3">
              <span className="text-lg font-semibold text-foreground">
                {formatNumber(summary.counts[category.key] as number)}
              </span>
              <span className="text-[11px] font-medium text-foreground">{category.label}</span>
              <span className="text-[11px] leading-snug text-foreground-subtle">{category.description}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Listed rather than hidden. "KIVO holds nothing of yours in these
          categories" is real information about your data, and a panel that
          only showed the non-empty ones would leave someone unable to tell the
          difference between "none" and "not covered here". */}
      {empty.length > 0 && (
        <p className="text-[11px] leading-relaxed text-foreground-subtle">
          <span className="font-medium text-foreground-muted">Nothing stored yet:</span>{" "}
          {empty.map((category) => category.label.toLowerCase()).join(", ")}.
        </p>
      )}

      {unreadable.length > 0 && (
        <p className="text-[11px] leading-relaxed text-critical" role="status">
          Couldn&apos;t read a count for {unreadable.map((category) => category.label.toLowerCase()).join(", ")} just
          now. These are shown as unavailable rather than as zero — the download below still includes them.
        </p>
      )}

      {children}
    </div>
  );
}
