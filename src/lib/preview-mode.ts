import "server-only";
import { cookies } from "next/headers";
import { hasAdminAccess } from "./admin";
import type { Profile } from "./profile";

/**
 * Admin-only "preview mode": lets an admin see what a page looks like once a
 * not-yet-synced field has real data, WITHOUT ever showing a fabricated number
 * to a real visitor. General-purpose infrastructure — not tied to any one
 * field or vendor; its original consumer (a market-value/contract-expiry
 * "Market" section gated on a Sportmonks-shaped schema) was removed on
 * 2026-08-15 when Sportmonks was dropped from the project (see DECISIONS.md),
 * but the mechanism itself stays, ready for the next not-yet-synced field that
 * needs it (a heatmap viewer, for instance). See ARCHITECTURE.md "Preview
 * mode" for the full write-up.
 *
 * Safety contract (do not weaken any of these):
 *  1. Requires a signed-in admin (hasAdminAccess(profile.role)) — checked
 *     fresh on every call, never cached across requests.
 *  2. Requires an explicit opt-in cookie, set only by the admin-gated route
 *     handler at /admin/preview-mode — there is no environment variable and
 *     no default-on path. A guest or non-admin session can never have this
 *     cookie accepted, even if they somehow set it themselves, because step 1
 *     is checked independently of the cookie every time.
 *  3. Every caller that renders a faked value MUST also render the
 *     PreviewModeBanner (see src/components/layout/preview-mode-banner.tsx)
 *     and mark the individual field (see src/components/ui/preview-marker.tsx)
 *     — this function alone only answers "is preview mode on", it does not
 *     enforce labeling at the call site.
 */
export const PREVIEW_MODE_COOKIE = "kivo_preview_mode";

/**
 * True only when BOTH the signed-in profile is an admin AND the opt-in
 * cookie is present. Either condition alone is not enough — a stray cookie
 * on a non-admin session (or a non-admin session that guesses the cookie
 * name/value) never activates preview mode, because `profile` here always
 * comes from a real server-side auth lookup (getOrCreateProfile()), never
 * from anything the client can influence directly.
 */
export async function isPreviewModeActive(profile: Pick<Profile, "role"> | null): Promise<boolean> {
  if (!hasAdminAccess(profile?.role)) return false;
  const cookieStore = await cookies();
  return cookieStore.get(PREVIEW_MODE_COOKIE)?.value === "1";
}
