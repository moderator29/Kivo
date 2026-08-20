import type { Metadata } from "next";
import { getOrCreateProfile } from "@/lib/profile";
import { ProfilePageShell } from "@/components/profile/profile-page-shell";
import { AvatarChoice } from "@/components/profile/avatar-choice";
import { resolveAvatarSrc } from "@/lib/kivo-assets";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";

export const metadata: Metadata = { title: "Profile photo" };

export default async function ProfileAvatarPage() {
  const profile = await getOrCreateProfile();
  // The (app) layout already guarantees a signed-in viewer with a real profile
  // row, so a null here is not a guest — it is a transient read failure between
  // that check and this one. See src/lib/guest-preview.ts.
  if (!profile) return <ProfileUnavailable />;

  return (
    <ProfilePageShell title="Profile photo">
      <AvatarChoice
        avatarType={profile.avatar_type}
        avatarKivoId={profile.avatar_kivo_id}
        currentSrc={resolveAvatarSrc(profile)}
      />
    </ProfilePageShell>
  );
}
