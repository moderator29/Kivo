"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Star } from "lucide-react";
import { toggleFollow } from "@/app/(app)/follow-actions";
import { GUEST_ACTION_TITLE } from "@/components/ui/guest-lock-hint";

/**
 * The star on a competition header that pins it to the top of the matches
 * list.
 *
 * ## It writes to `follows`, not to anything new
 *
 * A "favourite" here is a `follows` row with `followed_type = 'competition'`,
 * created through the same `toggleFollow` server action every other follow in
 * the product uses — rate limit, block check, badge award and revalidation
 * included. There is no second favourites concept and no second table: the
 * competitions starred here are the same ones /profile/following lists and the
 * same ones the Copilot reads as grounding context. Starring one on /matches
 * and seeing it appear under Following is the point, not a coincidence.
 *
 * ## Why not `FollowButton`
 *
 * `src/components/ui/follow-button.tsx` is the right control on a *detail*
 * page: a 40px circle that opens a 240px panel explaining what following does.
 * A matches list renders one of these per competition — eight or more on a
 * Saturday — and eight explanatory panels stacked down a phone screen is
 * noise, not clarity. This is the same action at list density: a bare star,
 * 32px of touch target, no popover. The explanation still exists where there
 * is room for it, on /leagues/[id] and in the confirmation FollowButton shows
 * there.
 *
 * Optimistic, with a real revert: the star flips immediately, and if the
 * server action fails it flips back and says so rather than leaving a lie on
 * screen. `router.refresh()` on success is what actually re-pins the group —
 * the ordering is computed on the server, so the list has to be re-rendered to
 * move.
 */
export function CompetitionFavouriteStar({
  competitionId,
  competitionName,
  initialFavourite,
  signedIn,
}: {
  competitionId: string;
  /** Only used for the accessible label, so a screen reader hears which
   * competition the star belongs to rather than "Favourite" eight times. */
  competitionName: string | null;
  initialFavourite: boolean;
  signedIn: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [favourite, setFavourite] = useState(initialFavourite);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // The server is the source of truth once the page re-renders: `router.refresh()`
  // below re-renders this tree without remounting, so without this a local
  // value would outlive the truth it was optimistic about. Adjusted during
  // render against the previous prop — React's documented pattern for this —
  // rather than in an effect, which would render once with the stale value
  // first. Held back while a toggle is in flight so the server's pre-write
  // answer cannot overwrite the optimistic one mid-transition.
  const [lastServerFavourite, setLastServerFavourite] = useState(initialFavourite);
  if (!pending && lastServerFavourite !== initialFavourite) {
    setLastServerFavourite(initialFavourite);
    setFavourite(initialFavourite);
  }

  useEffect(() => {
    if (!error) return;
    const timeout = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timeout);
  }, [error]);

  function handleClick() {
    if (!signedIn) {
      router.push(`/sign-up?redirect_url=${encodeURIComponent(pathname)}`);
      return;
    }
    if (pending) return;
    const previous = favourite;
    setError(null);
    setFavourite(!previous);
    startTransition(async () => {
      const result = await toggleFollow("competition", competitionId, previous);
      if (result.error) {
        setFavourite(previous);
        setError(result.error);
        return;
      }
      setFavourite(result.following);
      // Re-orders the list around the new favourite. Without this the star
      // changes colour and the group stays exactly where it was, which reads
      // as the feature not working.
      router.refresh();
    });
  }

  const label = competitionName
    ? `${favourite ? "Unfavourite" : "Favourite"} ${competitionName}`
    : favourite
      ? "Unfavourite this competition"
      : "Favourite this competition";

  return (
    <span className="relative flex shrink-0 items-center">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-busy={pending}
        aria-pressed={favourite}
        aria-label={label}
        title={!signedIn ? GUEST_ACTION_TITLE : label}
        // 36px of touch target on a 26px crest row: the founder uses a phone,
        // and this sits inches from a link to the competition page.
        className="kivo-focus -mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition hover:bg-surface-2 disabled:opacity-60"
      >
        <Star
          className={`h-4 w-4 transition ${favourite ? "fill-achievement text-achievement" : "text-foreground-subtle"}`}
          strokeWidth={1.75}
        />
      </button>
      {error && (
        <span
          role="alert"
          className="absolute top-full right-0 z-20 mt-1 w-max max-w-[13rem] text-right text-[11px] text-critical"
        >
          {error}
        </span>
      )}
    </span>
  );
}
