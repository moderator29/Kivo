import { NextResponse, type NextRequest } from "next/server";
import { getOrCreateProfile } from "@/lib/profile";
import { hasAdminAccess } from "@/lib/admin";
import { getAuthUser, sanitizeRedirectPath } from "@/lib/auth";
import { PREVIEW_MODE_COOKIE } from "@/lib/preview-mode";

/**
 * Admin-only toggle for preview mode (see src/lib/preview-mode.ts). This is
 * the ONLY place the opt-in cookie is ever set or cleared — nothing else in
 * the app writes it, so preview mode can never turn on by any path other
 * than an admin explicitly hitting this route.
 *
 * `GET /admin/preview-mode?on=1&redirect=/players/123` — turn preview mode
 * on and bounce back to the given (same-origin, root-relative) page.
 * `GET /admin/preview-mode?on=0` — turn it off.
 *
 * A GET route (not a form POST) so it can be a plain link from the UI, same
 * as the rest of KIVO's admin nav — this endpoint only flips a cookie for
 * the caller's own already-authenticated admin session, it doesn't mutate
 * any shared/persisted data, so it's low-risk as a GET.
 */
export async function GET(request: NextRequest) {
  // Same resource-level boundary as src/app/admin/layout.tsx: an
  // unauthenticated caller (which includes an environment with no auth
  // configured, since getAuthUser() returns null there too) gets bounced to
  // sign-in, and a signed-in non-admin gets bounced home. Preview mode can
  // never be reached by anyone this check would reject.
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  const profile = await getOrCreateProfile();
  if (!profile || !hasAdminAccess(profile.role)) {
    return NextResponse.redirect(new URL("/home", request.url));
  }

  const { searchParams } = new URL(request.url);
  const turnOn = searchParams.get("on") === "1";
  const redirectPath = sanitizeRedirectPath(searchParams.get("redirect") ?? undefined) ?? "/admin";

  const response = NextResponse.redirect(new URL(redirectPath, request.url));
  if (turnOn) {
    response.cookies.set(PREVIEW_MODE_COOKIE, "1", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      // Short-lived on purpose — an admin who forgets to turn it off doesn't
      // stay in a "sees fake data" session indefinitely.
      maxAge: 60 * 60 * 4,
    });
  } else {
    response.cookies.delete(PREVIEW_MODE_COOKIE);
  }
  return response;
}
