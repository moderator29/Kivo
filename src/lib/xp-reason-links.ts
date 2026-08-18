/**
 * Where an XP ledger line can honestly take you (KN-44).
 *
 * `/rewards` lists real `xp_ledger` rows — "+3 XP · Correct match prediction",
 * "+2 XP · Posted in the community" — and every one of them was a dead end.
 * The honest blocker is that `xp_ledger` has no target column: it records
 * *that* something was earned and why, never *which* post or *which*
 * prediction. So a per-row deep link is not buildable without inventing a
 * relationship the schema does not hold.
 *
 * What is buildable, and what this does, is narrower and still worth having:
 * map each reason *category* to the surface that category lives on. "Correct
 * match prediction" goes to your predictions, "Posted in the community" goes
 * to the feed. That is a real, checkable claim about where to look next,
 * rather than a fabricated pointer at one specific row.
 *
 * Matching is on the exact strings the writers use (they are constants at
 * three call sites, not user input) with a lowercase compare so a future
 * casing change doesn't silently break the link. An unrecognised reason
 * returns null and renders as plain text — a new XP source shows up as an
 * honest un-linked line rather than being routed somewhere plausible.
 */

export type XpReasonLink = { href: string; label: string };

const REASON_LINKS: { match: string; href: string; label: string }[] = [
  // src/app/admin/data-health/predictions-actions.ts
  { match: "correct match prediction", href: "/predictions/mine", label: "Your predictions" },
  // src/app/(app)/social/actions.ts (posts and polls)
  { match: "posted in the community", href: "/social", label: "The feed" },
  // src/app/onboarding/actions.ts
  { match: "completed onboarding", href: "/profile", label: "Your profile" },
];

export function xpReasonLink(reason: string): XpReasonLink | null {
  const normalized = reason.trim().toLowerCase();
  const entry = REASON_LINKS.find((candidate) => candidate.match === normalized);
  return entry ? { href: entry.href, label: entry.label } : null;
}
