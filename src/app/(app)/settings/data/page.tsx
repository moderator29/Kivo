import type { Metadata } from "next";
import { getOrCreateProfile } from "@/lib/profile";
import { DataExportSection } from "@/components/settings/data-export-section";
import { SettingsCard, SettingsPageShell } from "@/components/settings/settings-shell";
import { getSettingsSection } from "@/lib/settings-sections";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";

export const metadata: Metadata = { title: getSettingsSection("data").label };

export default async function DataSettingsPage() {
  const profile = await getOrCreateProfile();
  // The (app) layout already guarantees a signed-in viewer with a real profile
  // row, so a null here is not a guest — it is a transient read failure between
  // that check and this one. See src/lib/guest-preview.ts.
  if (!profile) return <ProfileUnavailable />;

  return (
    <SettingsPageShell sectionId="data">
      <SettingsCard>
        <DataExportSection username={profile.username} />
      </SettingsCard>
    </SettingsPageShell>
  );
}
