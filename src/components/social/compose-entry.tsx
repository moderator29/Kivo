"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { PenSquare, Plus, UserRound } from "lucide-react";
import { ViewportPortal } from "@/components/ui/viewport-portal";

/**
 * The way into the composer, now that composing is a page rather than a card
 * wedged above the feed.
 *
 * Two affordances for two reads of the same screen: a row at the top of the
 * feed that looks like the field it replaced, so the habit still works, and a
 * floating `+` that is reachable with a thumb after you have scrolled past
 * that row. Both go to /social/compose — the founder asked for a full page
 * "how X's one is", and a modal over a feed is neither a page nor dismissible
 * with the back gesture a phone user reaches for.
 */
export function ComposeEntry({
  signedIn,
  avatarUrl,
}: {
  signedIn: boolean;
  avatarUrl: string | null;
}) {
  const pathname = usePathname();

  if (!signedIn) {
    return (
      <Link
        href={`/sign-up?redirect_url=${encodeURIComponent(pathname)}`}
        className="kivo-glass kivo-focus flex items-center justify-between gap-3 rounded-2xl p-4 text-left transition-colors duration-150 hover:bg-surface-2"
      >
        <span className="flex items-center gap-2.5 text-sm text-foreground-subtle">
          <PenSquare className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          Sign up to share your take.
        </span>
        <span className="kivo-gradient-prime shrink-0 rounded-xl px-4 py-1.5 text-sm font-semibold text-on-accent">
          Sign up to post
        </span>
      </Link>
    );
  }

  return (
    <>
      <Link
        href="/social/compose"
        className="kivo-glass kivo-focus flex items-center gap-3 rounded-2xl p-3 transition-colors duration-150 hover:bg-surface-2"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-1">
          {avatarUrl ? (
            <Image src={avatarUrl} alt="" width={36} height={36} className="h-full w-full object-cover" unoptimized />
          ) : (
            <UserRound className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground-subtle">What&rsquo;s your take?</span>
        <span className="kivo-gradient-prime shrink-0 rounded-xl px-4 py-1.5 text-sm font-semibold text-on-accent">
          Post
        </span>
      </Link>

      {/* Sits above the bottom bar, on the right, where a thumb rests. Hidden
          on desktop, where the row above is always one scroll from the top and
          a floating button would just be a second control for one action.
          Portalled because "fixed" here has to mean the viewport, and this
          renders inside the page's own animated container — see
          ViewportPortal. */}
      <ViewportPortal>
        <Link
          href="/social/compose"
          aria-label="Write a post"
          className="kivo-gradient-prime kivo-glow-soft kivo-focus fixed bottom-[calc(env(safe-area-inset-bottom)+92px)] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full text-on-accent shadow-float transition-transform active:scale-95 lg:hidden"
        >
          <Plus className="h-6 w-6" strokeWidth={1.75} />
        </Link>
      </ViewportPortal>
    </>
  );
}
