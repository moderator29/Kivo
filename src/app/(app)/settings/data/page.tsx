import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOrCreateProfile } from "@/lib/profile";
import { signInHref } from "@/lib/auth";
import { DataExportSection } from "@/components/settings/data-export-section";
import { SettingsCard, SettingsPageShell } from "@/components/settings/settings-shell";
import { getSettingsSection } from "@/lib/settings-sections";

export const metadata: Metadata = { title: getSettingsSection("data").label };

export default async function DataSettingsPage() {
  const profile = await getOrCreateProfile();
  if (!profile) redirect(await signInHref());

  return (
    <SettingsPageShell sectionId="data">
      <SettingsCard>
        <DataExportSection username={profile.username} />
      </SettingsCard>
    </SettingsPageShell>
  );
}
