import type { Metadata } from "next";
import Link from "next/link";
import { CircleUserRound, LogOut, Mail, AtSign } from "lucide-react";
import { getOrCreateProfile } from "@/lib/profile";
import { effectiveModerationStatus } from "@/lib/moderation";
import { UsernameEditor } from "@/components/profile/username-editor";
import { FadeIn } from "@/components/ui/fade-in";
import { getNotificationPreferences } from "@/app/(app)/settings/actions";
import { signOut } from "@/app/(app)/session-actions";
import { getAuthUser } from "@/lib/auth";
import { NotificationPreferencesPanel } from "@/components/settings/notification-preferences-panel";
import { ModerationStatusPanel } from "@/components/settings/moderation-status-panel";
import { ProfileDetailsEditor } from "@/components/settings/profile-details-editor";
import { ActivityPrivacyToggle } from "@/components/settings/activity-privacy-toggle";
import { TimezoneSection } from "@/components/settings/timezone-section";
import { OtherDevicesSection } from "@/components/settings/other-devices-section";
import { DeleteAccountSection } from "@/components/settings/delete-account-section";
import { DataExportSection } from "@/components/settings/data-export-section";
import { YourDataSummary } from "@/components/settings/your-data-summary";
import { AvatarPicker } from "@/components/settings/avatar-picker";
import { AppearanceSection } from "@/components/theme/appearance-section";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const profile = await getOrCreateProfile();

  if (!profile) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 px-6 py-24 text-center">
        <CircleUserRound className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
        <p className="text-sm text-foreground-muted">Sign up to manage your settings.</p>
        <Link
          href="/sign-up"
          className="kivo-gradient-prime rounded-xl px-5 py-2.5 text-sm font-semibold text-on-accent kivo-raise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Sign up
        </Link>
      </div>
    );
  }

  // Email is the one identity field KIVO deliberately does NOT copy into
  // `profiles` (see ARCHITECTURE.md) — Supabase Auth owns it, so it is read
  // off the verified auth user at render time rather than from the profile
  // row. Previously the same value came from Clerk's currentUser().
  const [authUser, notificationPreferences] = await Promise.all([
    getAuthUser(),
    getNotificationPreferences(profile.id),
  ]);
  const email = authUser?.email ?? null;

  // RECOMMENDATIONS.md item 288: mirrors exactly what ModerationStatusPanel
  // itself renders for (suspended/banned only, lazy-expiry-adjusted — see
  // that component's own comment) so an active or shadow-muted account never
  // renders an empty flex child into this page's gap-6 column below.
  const moderationEffectiveStatus = effectiveModerationStatus(profile.moderation_status, profile.moderation_expires_at);
  const showModerationPanel = moderationEffectiveStatus === "suspended" || moderationEffectiveStatus === "banned";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn>
        <h1 className="text-lg font-semibold text-foreground">Settings</h1>
      </FadeIn>

      {showModerationPanel && (
        <FadeIn delay={0.04}>
          <ModerationStatusPanel
            status={profile.moderation_status}
            reason={profile.moderation_reason}
            expiresAt={profile.moderation_expires_at}
          />
        </FadeIn>
      )}

      <FadeIn delay={0.08} className="kivo-glass flex flex-col rounded-3xl p-5">
        <div className="flex flex-col gap-1.5 py-4">
          <span className="flex items-center gap-1.5 text-xs text-foreground-subtle">
            <Mail className="h-3 w-3" strokeWidth={2} />
            Email
          </span>
          <span className="text-sm font-semibold text-foreground">{email ?? "No email on file"}</span>
        </div>

        <div className="flex flex-col gap-1.5 border-t border-hairline-soft py-5">
          <span className="flex items-center gap-1.5 text-xs text-foreground-subtle">
            <AtSign className="h-3 w-3" strokeWidth={2} />
            Username
          </span>
          <UsernameEditor username={profile.username} />
        </div>

        <div className="flex flex-col gap-1.5 border-t border-hairline-soft py-5">
          <span className="text-xs text-foreground-subtle">Profile details</span>
          <ProfileDetailsEditor bio={profile.bio} country={profile.country} />
        </div>

        <div className="flex flex-col gap-3 border-t border-hairline-soft py-5">
          <TimezoneSection initialTimezone={profile.timezone} />
        </div>

        <div className="flex flex-col gap-3 border-t border-hairline-soft py-5">
          <span className="text-xs text-foreground-subtle">Privacy</span>
          <ActivityPrivacyToggle initialShowActivityPublicly={profile.show_activity_publicly} />
        </div>

        <div className="flex flex-col gap-3 border-t border-hairline-soft py-5">
          <span className="text-xs text-foreground-subtle">Avatar</span>
          <AvatarPicker
            profile={{
              avatar_type: profile.avatar_type,
              avatar_kivo_id: profile.avatar_kivo_id,
              avatar_uploaded_url: profile.avatar_uploaded_url,
              avatar_url: profile.avatar_url,
            }}
          />
        </div>

        <div className="flex flex-col gap-3 border-t border-hairline-soft py-5">
          <AppearanceSection />
        </div>

        <div className="flex flex-col gap-3 border-t border-hairline-soft py-5">
          <span className="text-xs text-foreground-subtle">Notifications</span>
          <NotificationPreferencesPanel initial={notificationPreferences} />
        </div>

        <div className="flex flex-col gap-3 border-t border-hairline-soft py-5">
          <YourDataSummary profileId={profile.id}>
            <DataExportSection username={profile.username} />
          </YourDataSummary>
        </div>

        <div className="flex flex-col gap-3 border-t border-hairline-soft py-5">
          <span className="text-sm font-semibold text-foreground">Other devices</span>
          <OtherDevicesSection />
        </div>

        <div className="flex flex-col gap-3 border-t border-hairline-soft pt-5">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-foreground">Session</span>
            <span className="text-xs text-foreground-subtle">Sign out of KIVO on this device.</span>
          </div>
          {/* A plain form posting to the server action, rather than a client
              component wrapping a button: the action already redirects, and
              this way the control still works with JavaScript disabled — one
              fewer client bundle than the Clerk <SignOutButton> it replaced. */}
          <form action={signOut}>
            <button
              type="submit"
              className="kivo-glass-sharp flex w-fit items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-foreground transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <LogOut className="h-4 w-4" strokeWidth={1.75} />
              Sign out
            </button>
          </form>
        </div>
      </FadeIn>

      <FadeIn delay={0.32} className="kivo-glass flex flex-col gap-4 rounded-3xl border border-critical/20 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-critical">Danger zone</h2>
        <DeleteAccountSection />
      </FadeIn>
    </div>
  );
}
