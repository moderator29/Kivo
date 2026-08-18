/**
 * Whether KIVO has a guest preview at all (KN-39).
 *
 * **It does not.** The founder's call, implemented in `src/app/(app)/layout.tsx`
 * on 2026-08-18: every route in the `(app)` group resolves the viewer's profile
 * and redirects a signed-out visitor to `/sign-in` before rendering anything.
 * There is no browsable-signed-out mode. The public surface is the marketing
 * pages (`/`, `/about`, `/terms`, `/privacy`, `/support`) and the auth pages,
 * and that is the whole of it.
 *
 * What this constant is for is the layer that gating left behind. KIVO used to
 * be fully browsable signed out, so roughly twenty components still take a
 * `signedIn` prop, render `<GuestLockHint>` when it is false, and
 * `router.push("/sign-up?redirect_url=…")` on tap. Inside the gate that state
 * is structurally unreachable — and the failure mode of leaving it undeclared
 * is not merely dead code, it is a *lying* padlock: a page whose own
 * `getOrCreateProfile()` read transiently fails would render every control as
 * locked and offer a signed-in user a sign-up button.
 *
 * The decision, recorded in DECISIONS.md: **keep the layer, behind this one
 * flag, rather than delete it.** Un-gating is a plausible future (an invite
 * preview, a public match page for shared links — see KN-119), the components
 * are otherwise untouched by it, and a flag makes the intent legible where
 * twenty scattered `signedIn={Boolean(profile)}` expressions did not. What is
 * not acceptable is the padlock appearing while the product is gated, and that
 * is what this stops.
 *
 * When the sweep completes (see the DECISIONS.md entry), every call site's
 * `signedIn` prop derives from `viewerIsSignedIn`, so flipping this constant is
 * the whole of re-enabling a guest preview.
 */
export const GUEST_PREVIEW_ENABLED = false;

/**
 * The single source of truth for a `signedIn` prop inside the `(app)` group.
 *
 * While the app is gated, this is always `true` — and that is the correct
 * answer, not a convenient one. The group's layout has already redirected
 * anyone without a session and already rendered `<ProfileUnavailable>` for
 * anyone whose profile row could not be read. A `null` profile reaching a page
 * underneath that is a transient read failure between two calls in the same
 * request, not a guest; treating it as a guest is how a signed-in user ends up
 * looking at a locked padlock and a sign-up button.
 *
 * With a guest preview enabled, it falls back to the real presence check.
 */
export function viewerIsSignedIn(profile: unknown): boolean {
  if (!GUEST_PREVIEW_ENABLED) return true;
  return Boolean(profile);
}
