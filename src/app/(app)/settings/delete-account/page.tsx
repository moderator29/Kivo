import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOrCreateProfile } from "@/lib/profile";
import { signInHref } from "@/lib/auth";
import { DeleteAccountSection } from "@/components/settings/delete-account-section";
import { SettingsCard, SettingsPageShell } from "@/components/settings/settings-shell";
import { getSettingsSection } from "@/lib/settings-sections";

export const metadata: Metadata = { title: getSettingsSection("danger").label };

/** On its own page for the same reason it used to sit inside a red-bordered
 * box at the very bottom of a long scroll: it must never be something you
 * arrive at by accident. A row you have to choose, then a confirmation you
 * have to type. */
export default async function DeleteAccountPage() {
  const profile = await getOrCreateProfile();
  if (!profile) redirect(await signInHref());

  return (
    <SettingsPageShell sectionId="danger">
      <SettingsCard className="border-critical/20">
        <DeleteAccountSection />
      </SettingsCard>
    </SettingsPageShell>
  );
}
