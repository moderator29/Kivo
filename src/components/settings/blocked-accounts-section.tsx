"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { unblockUser } from "@/app/(app)/block-actions";
import { RetryableError } from "@/components/ui/retryable-error";
import type { BlockedProfile } from "@/lib/blocks";

/**
 * The list of accounts this person has blocked, and the only place to undo one
 * without going to find the profile again.
 *
 * `blocks_select_own` (migration 0086) is what makes this list possible and
 * also what makes it exclusively theirs — there is no equivalent screen
 * anywhere showing who has blocked *you*, deliberately, because that screen
 * could not exist without announcing every block on it.
 */
export function BlockedAccountsSection({ blocked }: { blocked: BlockedProfile[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function unblock(profileId: string) {
    setError(null);
    setBusyId(profileId);
    startTransition(async () => {
      const result = await unblockUser(profileId);
      setBusyId(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (blocked.length === 0) {
    return (
      <p className="text-xs leading-relaxed text-foreground-subtle">
        You haven&apos;t blocked anyone. Blocking someone hides their posts and comments from you and yours from
        them — you can do it from their profile, and they are never told.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col">
        {blocked.map((account, index) => (
          <li
            key={account.id}
            className={`flex items-center justify-between gap-3 py-3 ${index > 0 ? "border-t border-hairline-soft" : "pt-0"}`}
          >
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-foreground">
                {account.displayName || (account.username ? `@${account.username}` : "Account no longer available")}
              </span>
              {account.username && account.displayName && (
                <span className="truncate text-xs text-foreground-subtle">@{account.username}</span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* An account KIVO can still resolve stays reachable — blocking
                  is not a memory hole, and a person changing their mind should
                  be able to look before they undo. */}
              {account.username && (
                <Link
                  href={`/u/${account.username}`}
                  className="kivo-focus rounded-lg px-2 py-1 text-xs text-foreground-subtle transition-colors hover:text-foreground"
                >
                  View
                </Link>
              )}
              <button
                type="button"
                disabled={pending}
                aria-busy={pending && busyId === account.id}
                onClick={() => unblock(account.id)}
                className="kivo-glass-sharp kivo-focus flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-foreground transition-transform active:scale-95 disabled:opacity-60"
              >
                {pending && busyId === account.id && <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />}
                Unblock
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && <RetryableError size="xs" message={error} retrying={pending} />}
      <p className="text-[11px] leading-relaxed text-foreground-subtle">
        Unblocking lets you see each other again. It does not restore a follow the block removed.
      </p>
    </div>
  );
}
