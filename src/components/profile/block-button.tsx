"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, Loader2 } from "lucide-react";
import { blockUser, unblockUser } from "@/app/(app)/block-actions";
import { RetryableError } from "@/components/ui/retryable-error";

/**
 * Block / unblock, on someone else's profile.
 *
 * Two-step on the way in, one-step on the way out. Blocking is a real,
 * relationship-ending action — it silently drops any follow in either
 * direction (migration 0086's `trg_blocks_sever_follows`) and that follow is
 * not restored by unblocking — so tapping it once by accident should not be
 * possible. Unblocking undoes nothing and costs nothing, so it is one tap.
 *
 * The confirmation says exactly what will happen, including the part people do
 * not expect (the follow does not come back). A confirmation that only asks
 * "are you sure?" is a speed bump, not informed consent.
 */
export function BlockButton({
  targetProfileId,
  targetName,
  initialBlocked,
  signedIn,
}: {
  targetProfileId: string;
  targetName: string;
  initialBlocked: boolean;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [blocked, setBlocked] = useState(initialBlocked);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!signedIn) return null;

  function run(next: boolean) {
    setError(null);
    startTransition(async () => {
      const result = next ? await blockUser(targetProfileId) : await unblockUser(targetProfileId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setBlocked(next);
      setConfirming(false);
      // Their posts have just left (or rejoined) every list on this page, and
      // that is a server-rendered fact — a local state flip would leave the
      // page showing content the database no longer returns.
      router.refresh();
    });
  }

  if (blocked) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          disabled={pending}
          aria-busy={pending}
          onClick={() => run(false)}
          className="kivo-glass-sharp kivo-focus flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-foreground-muted transition-transform active:scale-95 disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          ) : (
            <Check className="h-3.5 w-3.5" strokeWidth={2} />
          )}
          Blocked
        </button>
        {error && <RetryableError size="xs" message={error} retrying={pending} onRetry={() => run(false)} />}
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="kivo-glass flex w-full flex-col gap-2 rounded-2xl p-4">
        <p className="text-sm font-semibold text-foreground">Block {targetName}?</p>
        <p className="text-xs leading-relaxed text-foreground-muted">
          You won&apos;t see their posts or comments, and they won&apos;t see yours. If either of you follows the
          other, that follow is removed — unblocking later does not bring it back. They are never told.
        </p>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            disabled={pending}
            aria-busy={pending}
            onClick={() => run(true)}
            className="kivo-focus flex items-center gap-1.5 rounded-xl bg-critical/15 px-4 py-2 text-xs font-semibold text-critical transition-transform active:scale-95 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <Ban className="h-3.5 w-3.5" strokeWidth={2} />}
            Block
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setConfirming(false);
              setError(null);
            }}
            className="kivo-focus rounded-xl px-3 py-2 text-xs font-semibold text-foreground-muted transition-colors hover:text-foreground disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
        {error && <RetryableError size="xs" message={error} retrying={pending} onRetry={() => run(true)} />}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="kivo-focus flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-foreground-subtle transition-colors hover:text-critical"
    >
      <Ban className="h-3.5 w-3.5" strokeWidth={2} />
      Block
    </button>
  );
}
