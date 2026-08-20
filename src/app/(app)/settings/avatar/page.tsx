import type { Metadata } from "next";
import { getOrCreateProfile } from "@/lib/profile";
import { AvatarPicker } from "@/components/settings/avatar-picker";
import { SettingsCard, SettingsPageShell } from "@/components/settings/settings-shell";
import { getSettingsSection } from "@/lib/settings-sections";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";

export const metadata: Metadata = { title: getSettingsSection("avatar").label };

/** The picker is a grid of real KIVO artwork — the single largest control in
 * Settings, and the one that most obviously wanted a page of its own rather
 * than a slot in a stack of nine. */
export default async function AvatarSettingsPage() {
  const profile = await getOrCreateProfile();
  // The (app) layout already guarantees a signed-in viewer with a real profile
  // row, so a null here is not a guest — it is a transient read failure between
  // that check and this one. See src/lib/guest-preview.ts.
  if (!profile) return <ProfileUnavailable />;

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
