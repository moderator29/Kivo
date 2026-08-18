import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOrCreateProfile } from "@/lib/profile";
import { ProfilePageShell } from "@/components/profile/profile-page-shell";
import { BioEditor } from "@/components/profile/bio-editor";

export const metadata: Metadata = { title: "Your bio" };

export default async function EditBioPage() {
  const profile = await getOrCreateProfile();
  if (!profile) redirect(`/sign-up?redirect_url=${encodeURIComponent("/profile/edit/bio")}`);

  return (
    <ProfilePageShell
      title="Bio"
      description="Up to 500 characters, shown under your name on your profile."
    >
      <BioEditor bio={profile.bio} />
    </ProfilePageShell>
  );
}
