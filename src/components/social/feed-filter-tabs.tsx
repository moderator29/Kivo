"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { SectionTabs, type SectionTab } from "@/components/ui/section-tabs";
import { SOCIAL_FILTERS, SOCIAL_FILTER_LABELS, socialFilterHref, type SocialFilter } from "@/lib/social-filters";

/**
 * The feed's four readings, on the app's one tab rail.
 *
 * This used to be a hand-rolled pill strip with its own scroller, its own
 * `layoutId` indicator and its own focus handling — one of the six independent
 * solutions to the same problem that made the product read as assembled rather
 * than designed. It is now `SectionTabs` (docs/UI_PRIMITIVES.md), which brings
 * the edge fades, the roving tabindex, the arrow keys and the 44px targets
 * this never had.
 *
 * `tone="pill"` rather than `underline` on purpose: the rail is not choosing a
 * *place* on this screen, it is filtering the one thing the screen is — which
 * is the exact distinction the primitive draws between its two tones.
 *
 * WHY IT STILL CHANGES THE URL
 * ---------------------------------------------------------------------------
 * Each reading is a different server query — "posts by people who support my
 * club" cannot be filtered out of a list the browser already holds, because
 * the client is never sent one — so the tab has to reach the server either
 * way. Keeping it in `?filter=` is what makes a feed shareable and the back
 * gesture work, and the page stays `/social` throughout, so this is a filter
 * with a shareable address rather than navigation between routes.
 *
 * `useTransition` is what stops that round trip reading as a dead tap: React
 * keeps the current feed on screen and marks the rail busy while the next one
 * is fetched, instead of blanking the page.
 */
export function FeedFilterTabs({ active }: { active: SocialFilter }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // No counts. KIVO does not know how many posts are in a feed it has not
  // fetched, and a tab that says a number it has not counted is the one thing
  // the rail's contract forbids outright.
  const tabs: SectionTab<SocialFilter>[] = SOCIAL_FILTERS.map((filter) => ({
    id: filter,
    label: SOCIAL_FILTER_LABELS[filter],
  }));

  return (
    <SectionTabs
      tabs={tabs}
      value={active}
      onChange={(next) => {
        if (next === active) return;
        startTransition(() => router.push(socialFilterHref(next), { scroll: false }));
      }}
      ariaLabel="Feed filter"
      idPrefix="social-feed"
      tone="pill"
      bleed
      className={pending ? "opacity-70 transition-opacity" : undefined}
    />
  );
}
