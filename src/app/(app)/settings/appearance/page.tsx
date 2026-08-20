import type { Metadata } from "next";
import { getOrCreateProfile } from "@/lib/profile";
import { AppearanceSection } from "@/components/theme/appearance-section";
import { TimezoneSection } from "@/components/settings/timezone-section";
import { SettingsCard, SettingsPageShell } from "@/components/settings/settings-shell";
import { getSettingsSection } from "@/lib/settings-sections";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";

export const metadata: Metadata = { title: getSettingsSection("appearance").label };

export default async function AppearanceSettingsPage() {
  const profile = await getOrCreateProfile();
  // The (app) layout already guarantees a signed-in viewer with a real profile
  // row, so a null here is not a guest — it is a transient read failure between
  // that check and this one. See src/lib/guest-preview.ts.
  if (!profile) return <ProfileUnavailable />;

  return (
    <SettingsPageShell sectionId="appearance">
      <SettingsCard>
        <AppearanceSection />
        {/* The same control also sits at the bottom of the nav drawer and the
            desktop sidebar, where it is one tap from anywhere — this page is
            where the full three-option choice and its explanation live. */}
      </SettingsCard>
      <SettingsCard delay={0.04}>
        <TimezoneSection initialTimezone={profile.timezone} />
      </SettingsCard>
    </SettingsPageShell>
  );
}
