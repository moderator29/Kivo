import { Lock } from "lucide-react";
import { GUEST_PREVIEW_ENABLED } from "@/lib/guest-preview";

/**
 * Shared tooltip text for every guest-gated control that silently
 * `router.push`es a signed-out visitor to `/sign-up` on tap (RECOMMENDATIONS
 * item 235) — one string so the cue reads identically everywhere it shows up,
 * rather than slightly different phrasing per component. Pass as the
 * control's own `title` attribute (`title={!signedIn ? GUEST_ACTION_TITLE :
 * undefined}`) alongside `GuestLockHint` below.
 */
export const GUEST_ACTION_TITLE = "Sign up to do this";

/**
 * Small inline lock glyph marking a guest-gated control (RECOMMENDATIONS
 * item 235): `PredictionCard`, `FollowButton`, `FanRatingCard`,
 * `save-button.tsx`, `ReactionPicker`, the post report button, poll voting,
 * and comment/reply composers all silently redirect a signed-out visitor to
 * `/sign-up` on first tap, with no prior visual hint the tap needs an
 * account — flagged as needing one consistent design decision applied
 * everywhere rather than a per-component patch. This is that one shared cue,
 * used at every one of those call sites. Plain inline flow, not absolutely
 * positioned, so it never needs a specially-positioned parent — just drop it
 * next to the control's existing icon/label. Renders nothing once `show` is
 * false, so a signed-in viewer's controls never pick up a locked look.
 */
export function GuestLockHint({ show, className }: { show: boolean; className?: string }) {
  // KN-39: the padlock is gated on the product having a guest preview at all,
  // not only on this one call site's `signedIn` prop. With the app fully gated
  // a locked control is unreachable by design — and if a page's own profile
  // read transiently fails, the honest outcome is a control that works and
  // reports a real error, never one that tells a signed-in user they need an
  // account. One flag, checked once, instead of trusting twenty call sites to
  // agree.
  if (!GUEST_PREVIEW_ENABLED || !show) return null;
  return <Lock className={className ?? "h-3 w-3 shrink-0"} strokeWidth={2.5} aria-hidden="true" />;
}
