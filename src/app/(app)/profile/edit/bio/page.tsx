import type { Metadata } from "next";
import { getOrCreateProfile } from "@/lib/profile";
import { ProfilePageShell } from "@/components/profile/profile-page-shell";
import { BioEditor } from "@/components/profile/bio-editor";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";

export const metadata: Metadata = { title: "Your bio" };

export default async function EditBioPage() {
  const profile = await getOrCreateProfile();
  // The (app) layout already guarantees a signed-in viewer with a real profile
  // row, so a null here is not a guest — it is a transient read failure between
  // that check and this one. See src/lib/guest-preview.ts.
  if (!profile) return <ProfileUnavailable />;

  return (
    <ProfilePageShell
      title="Bio"
      description="Up to 500 characters, shown under your name on your profile."
    >
      <BioEditor bio={profile.bio} />
    </ProfilePageShell>
  );
}
