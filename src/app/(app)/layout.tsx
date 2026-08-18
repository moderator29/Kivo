import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getOrCreateProfile } from "@/lib/profile";
import { isClerkConfigured } from "@/lib/clerk";
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
  // Every route under (app) is guest-viewable by design: KIVO is browsable
  // signed out (scores, teams, players, leagues, social feed, predictions
  // list), and each individual page/action decides for itself whether it
  // needs a profile (see getOrCreateProfile() call sites — every one of them
  // already treats a null profile as "guest", not an error). This layout's
  // only job is to resolve WHO the visitor is, not to gate access — that's
  // deliberately different from src/app/admin/layout.tsx, which protects a
  // real privileged surface. See src/proxy.ts for why this can't live in
  // middleware either way.
  const profile = isClerkConfigured() ? await getOrCreateProfile() : null;

  // Only a signed-in user can be "mid-onboarding" — a guest has no profile
  // row to be incomplete, so this never fires for them.
  if (profile && !profile.onboarding_completed) {
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
  if (profile) {
    const status = effectiveModerationStatus(profile.moderation_status, profile.moderation_expires_at);
    if (status === "suspended" && profile.moderation_expires_at) {
      moderationBanner = { kind: "suspended", reason: profile.moderation_reason, expiresAt: profile.moderation_expires_at };
    } else if (status === "banned") {
      moderationBanner = { kind: "banned", reason: profile.moderation_reason };
    }
  }

  return (
    <AppShell
      signedIn={Boolean(profile)}
      isAdmin={hasAdminAccess(profile?.role)}
      previewMode={previewMode}
      viewerProfile={
        profile ? { username: profile.username, displayName: profile.display_name, avatarUrl: resolveAvatarSrc(profile) } : null
      }
      moderationBanner={moderationBanner}
    >
      {children}
    </AppShell>
  );
}
