import type { Metadata } from "next";
import { getOrCreateProfile } from "@/lib/profile";
import { ProfilePageShell } from "@/components/profile/profile-page-shell";
import { BackgroundChoice } from "@/components/profile/background-choice";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";

export const metadata: Metadata = { title: "Profile background" };

export default async function ProfileBackgroundPage() {
  const profile = await getOrCreateProfile();
  // The (app) layout already guarantees a signed-in viewer with a real profile
  // row, so a null here is not a guest — it is a transient read failure between
  // that check and this one. See src/lib/guest-preview.ts.
  if (!profile) return <ProfileUnavailable />;

  return (
    <ProfilePageShell title="Profile background">
      <BackgroundChoice
        backgroundId={profile.background_id}
        backgroundUploadedUrl={profile.background_uploaded_url}
      />
    </ProfilePageShell>
  );
}
