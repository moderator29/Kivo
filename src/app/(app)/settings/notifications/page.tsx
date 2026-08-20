import type { Metadata } from "next";
import { getOrCreateProfile } from "@/lib/profile";
import { getNotificationPreferences, getQuietHours } from "@/app/(app)/settings/actions";
import { QuietHoursSection } from "@/components/settings/quiet-hours-section";
import { NotificationPreferencesPanel } from "@/components/settings/notification-preferences-panel";
import { NotificationMutesPanel } from "@/components/settings/notification-mutes-panel";
import { getNotifiableEntities } from "@/app/(app)/settings/notification-mute-actions";
import { SettingsCard, SettingsLinkRow, SettingsPageShell } from "@/components/settings/settings-shell";
import { getSettingsSection } from "@/lib/settings-sections";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";

export const metadata: Metadata = { title: getSettingsSection("notifications").label };

export default async function NotificationSettingsPage() {
  const profile = await getOrCreateProfile();
  // The (app) layout already guarantees a signed-in viewer with a real profile
  // row, so a null here is not a guest — it is a transient read failure between
  // that check and this one. See src/lib/guest-preview.ts.
  if (!profile) return <ProfileUnavailable />;

  const [preferences, quietHours, notifiableEntities] = await Promise.all([
    getNotificationPreferences(),
    getQuietHours(),
    getNotifiableEntities(),
  ]);

  return (
    <SettingsPageShell sectionId="notifications">
      <SettingsCard>
        <NotificationPreferencesPanel initial={preferences} />
      </SettingsCard>

      {/* Migration 0088. Sits directly under the type toggles because it is
          the same question one level down: not "do I want to hear about this"
          but "do I want to hear about it right now". */}
      <SettingsCard title="Quiet hours" delay={0.04}>
        <QuietHoursSection initial={quietHours} timeZone={profile.timezone ?? null} />
      </SettingsCard>

      {/* Migration 0104. The preferences above decide notification *types*;
          this decides which clubs, players and competitions they are about —
          the "this club, not that one" half. It used to be a link to
          /profile/following, which could only reach entities the user follows:
          a favourite club has no follow row and a competition had no control at
          all, so the two things people most want to silence were the two this
          page could not offer. */}
      <SettingsCard title="What you hear about" delay={0.08}>
        <NotificationMutesPanel entities={notifiableEntities} />
        <SettingsLinkRow
          href="/profile/following"
          label="Manage who you follow"
          description="Unfollow a club or player instead of muting it."
        />
      </SettingsCard>
    </SettingsPageShell>
  );
}
