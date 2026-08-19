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
  return (
    <div className="sticky top-0 z-20 flex items-center gap-1 border-b border-hairline-soft bg-background/80 px-2 py-2 backdrop-blur-xl lg:px-6">
      <RouteBackLink />
    </div>
  );
}
