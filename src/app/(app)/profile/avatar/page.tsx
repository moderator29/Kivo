import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOrCreateProfile } from "@/lib/profile";
import { ProfilePageShell } from "@/components/profile/profile-page-shell";
import { AvatarChoice } from "@/components/profile/avatar-choice";
import { resolveAvatarSrc } from "@/lib/kivo-assets";

export const metadata: Metadata = { title: "Profile photo" };

export default async function ProfileAvatarPage() {
  const profile = await getOrCreateProfile();
  if (!profile) redirect(`/sign-up?redirect_url=${encodeURIComponent("/profile/avatar")}`);

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
