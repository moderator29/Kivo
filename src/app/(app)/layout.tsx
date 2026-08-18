import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { resolveViewerProfile } from "@/lib/profile";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";
import { hasAdminAccess } from "@/lib/admin";
import { isPreviewModeActive } from "@/lib/preview-mode";
import { resolveAvatarSrc } from "@/lib/kivo-assets";
import { effectiveModerationStatus } from "@/lib/moderation";
import type { ModerationBannerInfo } from "@/components/layout/moderation-banner";

// Every route here renders differently for a guest vs a signed-in profile
// (and, for a signed-in user, per-user data), so nothing under (app) is safe
// to prerender or cache statically.
export const dynamic = "force-dynamic";

export default async function AppGroupLayout({ children }: { children: ReactNode }) {
  // Everything under (app) is now behind the door. This reverses the previous
  // guest-preview design: KIVO used to be browsable signed out (scores, teams,
  // players, leagues, social feed, predictions list) with each page treating a
  // null profile as "guest". Founder's call — there is no guest preview of the
  // product at all. The public marketing surface (/, /about, /terms, /privacy)
  // is a sibling of this group and is unaffected.
  //
  // This is the real authorization boundary for the group, not src/proxy.ts:
  // getOrCreateProfile() resolves the caller through getAuthUser(), which
  // verifies the JWT signature against Supabase's JWKS rather than trusting the
  // session cookie. It returns null both for a signed-out visitor and when auth
  // isn't configured for this environment, and either way the answer is the
  // same. See src/proxy.ts for why a middleware matcher can't be trusted with
  // this job.
  const viewer = await resolveViewerProfile();
  if (viewer.status === "anonymous") {
    redirect("/sign-in");
  }

  // Signed in, but the profile row could not be read or created. Deliberately
  // NOT a redirect: /sign-in would see the valid session and bounce them
  // straight back here, and the two would trade the user back and forth
  // forever. Stop, and say so.
  if (viewer.status === "unavailable") {
    return <ProfileUnavailable />;
  }

  const profile = viewer.profile;

  // A brand-new account lands here on its very first authenticated request
  // (getOrCreateProfile just created the row), so this is what actually carries
  // a fresh signee into onboarding.
  if (!profile.onboarding_completed) {
    redirect("/onboarding");
  }

  // Admin-only, opt-in-only (see src/lib/preview-mode.ts) — false for every
  // guest and every non-admin, full stop, regardless of what's in the URL.
  const previewMode = await isPreviewModeActive(profile);

  // RECOMMENDATIONS.md item 234: a suspended/banned viewer sees a clear,
  // honest banner instead of their posts/predictions/reactions silently
  // failing (they're really being rejected server-side by RLS — see
  // supabase/migrations/0045_moderation_status.sql). Null for a guest, an
  // active user, or a shadow-muted one — shadow-mute is deliberately
  // zero-friction to the muted user themselves, so it never shows here.
  let moderationBanner: ModerationBannerInfo | null = null;
  const status = effectiveModerationStatus(profile.moderation_status, profile.moderation_expires_at);
  if (status === "suspended" && profile.moderation_expires_at) {
    moderationBanner = { kind: "suspended", reason: profile.moderation_reason, expiresAt: profile.moderation_expires_at };
  } else if (status === "banned") {
    moderationBanner = { kind: "banned", reason: profile.moderation_reason };
  }

  return (
    <AppShell
      signedIn
      isAdmin={hasAdminAccess(profile.role)}
      previewMode={previewMode}
      viewerProfile={{
        username: profile.username,
        displayName: profile.display_name,
        avatarUrl: resolveAvatarSrc(profile),
      }}
      moderationBanner={moderationBanner}
    >
      {children}
    </AppShell>
  );
}
