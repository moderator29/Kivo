"use client";

import { RouteBackLink } from "@/components/ui/back-link";

/**
 * The only chrome a focus route gets: one way back.
 *
 * A focus route is any screen you went *into* — a fixture, a team, a player,
 * Settings and everything under it, the composer, AI Copilot (see
 * src/lib/route-class.ts for the rule). It has no bottom bar and no top bar, so
 * this row is genuinely the only way out and everything about it has to be
 * right: a 44px target, a label that names where it goes, a real URL behind it,
 * and history when history is KIVO's. All of that lives in `<BackLink>`, which
 * the rest of the platform uses too — this component's whole job is to place
 * one, name it, and keep it stuck to the top of the screen.
 */
export function FocusHeader() {
  // Same height as `TopBar`, from the same variable. They were 61px and 65px:
  // small enough to look like nothing, large enough that moving between a tab
  // route and a focus route nudged the whole page — and it meant no sticky
  // offset could have been correct on both.
  return (
    <div className="sticky top-0 z-20 flex h-[var(--kivo-header-h)] items-center gap-1 border-b border-hairline-soft bg-background/80 px-2 backdrop-blur-xl lg:px-6">
      <RouteBackLink />
    </div>
  );
}
