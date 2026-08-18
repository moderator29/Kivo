import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOrCreateProfile } from "@/lib/profile";
import { signInHref } from "@/lib/auth";
import { AvatarPicker } from "@/components/settings/avatar-picker";
import { SettingsCard, SettingsPageShell } from "@/components/settings/settings-shell";
import { getSettingsSection } from "@/lib/settings-sections";

export const metadata: Metadata = { title: getSettingsSection("avatar").label };

/** The picker is a grid of real KIVO artwork — the single largest control in
 * Settings, and the one that most obviously wanted a page of its own rather
 * than a slot in a stack of nine. */
export default async function AvatarSettingsPage() {
  const profile = await getOrCreateProfile();
  if (!profile) redirect(await signInHref());

  return (
    <SettingsPageShell sectionId="avatar">
      <SettingsCard>
        <AvatarPicker
          profile={{
            avatar_type: profile.avatar_type,
            avatar_kivo_id: profile.avatar_kivo_id,
            avatar_uploaded_url: profile.avatar_uploaded_url,
            avatar_url: profile.avatar_url,
          }}
        />
      </SettingsCard>
    </SettingsPageShell>
  );
}
