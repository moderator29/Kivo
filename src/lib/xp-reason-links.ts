/**
 * Where an XP ledger line can honestly take you (KN-44).
 *
 * `/rewards` lists real `xp_ledger` rows — "+3 XP · Correct prediction ·
 * Winner", "+2 XP · Posted in the community" — and every one of them used to
 * be a dead end. The honest blocker is that `xp_ledger` has no *target*
 * column: it records that something was earned and why, never which post or
 * which prediction. A per-row deep link to the exact object is still not
 * buildable without inventing a relationship the schema does not hold.
 *
 * What is buildable is the surface each award category lives on, and this now
 * derives that from `source_key` rather than from the prose in `reason`.
 *
 * That change has a scar behind it worth keeping. The original version matched
 * the exact reason strings — "correct match prediction", "posted in the
 * community" — on the reasoning that they are constants at three call sites,
 * not user input. True, and still not safe: when predictions grew from one
 * type to six, the writer started composing the reason per type, every
 * prediction row silently stopped matching, and the links went dead with
 * nothing failing. Prose is a bad join key precisely because changing prose
 * feels like a copy edit.
 *
 * `source_key` is a real structural field with a `kind:id` shape that the
 * award path has to get right for idempotency anyway, so it cannot drift
 * without something louder breaking first. Reason matching is kept as a
 * fallback for legacy rows written before `source_key` existed (migration
 * 0061) and for the rare deliberately-unkeyed award.
 *
 * An unrecognised row returns null and renders as plain text — a new XP source
 * shows up as an honest un-linked line rather than being routed somewhere
 * plausible.
 */

export type XpReasonLink = { href: string; label: string };

/** Keyed on the `kind:` prefix of `xp_ledger.source_key`. */
const SOURCE_KIND_LINKS: Record<string, XpReasonLink> = {
  // src/app/admin/football/predictions-actions.ts — `prediction:<id>`,
  // and its `prediction:<id>:adj:<n>` reconciliation rows, which share the
  // prefix on purpose so an adjustment links to the same place as the award
  // it corrects.
  prediction: { href: "/predictions/mine", label: "Your predictions" },
  // src/lib/xp-policy.ts — `post:<id>`, written by createPost, createPoll,
  // createMotmPoll and createRefereePoll alike.
  post: { href: "/social", label: "The feed" },
  // src/app/onboarding/actions.ts — `onboarding:<profile id>`.
  onboarding: { href: "/profile", label: "Your profile" },
};

/** Fallback for rows with no `source_key` at all. Matched on the opening of
 * the reason rather than the whole string, so appending a qualifier after a
 * separator (as the six prediction types do) cannot break the match again. */
const REASON_PREFIX_LINKS: { prefix: string; link: XpReasonLink }[] = [
  { prefix: "correct prediction", link: { href: "/predictions/mine", label: "Your predictions" } },
  { prefix: "correct match prediction", link: { href: "/predictions/mine", label: "Your predictions" } },
  { prefix: "prediction re-scored", link: { href: "/predictions/mine", label: "Your predictions" } },
  { prefix: "posted in the community", link: { href: "/social", label: "The feed" } },
  { prefix: "completed onboarding", link: { href: "/profile", label: "Your profile" } },
];

export function xpReasonLink(reason: string, sourceKey?: string | null): XpReasonLink | null {
  if (sourceKey) {
    const kind = sourceKey.split(":", 1)[0];
    const bySource = SOURCE_KIND_LINKS[kind];
    if (bySource) return bySource;
  }

  const normalized = reason.trim().toLowerCase();
  const entry = REASON_PREFIX_LINKS.find((candidate) => normalized.startsWith(candidate.prefix));
  return entry ? entry.link : null;
}
