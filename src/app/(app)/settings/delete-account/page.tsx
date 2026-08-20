import type { Metadata } from "next";
import { getOrCreateProfile } from "@/lib/profile";
import { DeleteAccountSection } from "@/components/settings/delete-account-section";
import { SettingsCard, SettingsPageShell } from "@/components/settings/settings-shell";
import { getSettingsSection } from "@/lib/settings-sections";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";

export const metadata: Metadata = { title: getSettingsSection("danger").label };

/** On its own page for the same reason it used to sit inside a red-bordered
 * box at the very bottom of a long scroll: it must never be something you
 * arrive at by accident. A row you have to choose, then a confirmation you
 * have to type. */
export default async function DeleteAccountPage() {
  const profile = await getOrCreateProfile();
  // The (app) layout already guarantees a signed-in viewer with a real profile
  // row, so a null here is not a guest — it is a transient read failure between
  // that check and this one. See src/lib/guest-preview.ts.
  if (!profile) return <ProfileUnavailable />;

  return (
    <SettingsPageShell sectionId="danger">
      <SettingsCard className="border-critical/20">
        <DeleteAccountSection />
      </SettingsCard>
    </SettingsPageShell>
  );
}
