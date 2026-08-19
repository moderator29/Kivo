import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOrCreateProfile } from "@/lib/profile";
import { signInHref } from "@/lib/auth";
import { getNotificationPreferences, getQuietHours } from "@/app/(app)/settings/actions";
import { QuietHoursSection } from "@/components/settings/quiet-hours-section";
import { NotificationPreferencesPanel } from "@/components/settings/notification-preferences-panel";
import { SettingsCard, SettingsLinkRow, SettingsPageShell } from "@/components/settings/settings-shell";
import { getSettingsSection } from "@/lib/settings-sections";

export const metadata: Metadata = { title: getSettingsSection("notifications").label };

export default async function NotificationSettingsPage() {
  const profile = await getOrCreateProfile();
  if (!profile) redirect(await signInHref());

  const [preferences, quietHours] = await Promise.all([
    getNotificationPreferences(profile.id),
    getQuietHours(profile.id),
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

      {/* These preferences decide notification *types*; muting decides which
          clubs and players they are about. Two halves of one question that
          lived on two pages with no link between them. */}
      <SettingsCard title="Muted clubs and players" delay={0.08}>
        <SettingsLinkRow
          href="/profile/following"
          label="Mute a club or player"
          description="Silence alerts for one team without unfollowing it."
        />
      </SettingsCard>
    </SettingsPageShell>
  );
}
