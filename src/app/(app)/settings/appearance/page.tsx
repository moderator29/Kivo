import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOrCreateProfile } from "@/lib/profile";
import { signInHref } from "@/lib/auth";
import { AppearanceSection } from "@/components/theme/appearance-section";
import { TimezoneSection } from "@/components/settings/timezone-section";
import { SettingsCard, SettingsPageShell } from "@/components/settings/settings-shell";
import { getSettingsSection } from "@/lib/settings-sections";

export const metadata: Metadata = { title: getSettingsSection("appearance").label };

export default async function AppearanceSettingsPage() {
  const profile = await getOrCreateProfile();
  if (!profile) redirect(await signInHref());

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
