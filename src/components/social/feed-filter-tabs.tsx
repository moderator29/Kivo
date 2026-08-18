"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { SOCIAL_FILTERS, SOCIAL_FILTER_LABELS, socialFilterHref, type SocialFilter } from "@/lib/social-filters";
import { cn } from "@/lib/utils";

/**
 * The feed's four readings. Plain links to a different query, not client-side
 * tab state: which feed you are reading is a real, shareable, back-button-able
 * location, and the server has to re-query for it anyway.
 *
 * Horizontally scrollable at 390px rather than wrapped or truncated — four
 * labels, one of which is two words, do not fit a phone's width, and a tab
 * strip that wraps to two lines stops reading as a tab strip.
 */
export function FeedFilterTabs({ active }: { active: SocialFilter }) {
  return (
    <nav aria-label="Feed filter" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:px-0">
      <ul className="flex w-max items-center gap-1 rounded-full border border-hairline bg-surface-1 p-1">
        {SOCIAL_FILTERS.map((filter) => {
          const isActive = filter === active;
          return (
            <li key={filter}>
              <Link
                href={socialFilterHref(filter)}
                aria-current={isActive ? "page" : undefined}
                scroll={false}
                className={cn(
                  "kivo-focus relative flex items-center rounded-full px-3.5 py-2 text-xs font-semibold transition-colors",
                  isActive ? "text-on-accent" : "text-foreground-subtle hover:text-foreground",
                )}
              >
                {isActive && (
                  <motion.span
                    aria-hidden="true"
                    layoutId="social-filter-active"
                    className="kivo-gradient-prime absolute inset-0 rounded-full"
                    transition={{ type: "spring", stiffness: 480, damping: 40 }}
                  />
                )}
                <span className="relative whitespace-nowrap">{SOCIAL_FILTER_LABELS[filter]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
