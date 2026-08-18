import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOrCreateProfile } from "@/lib/profile";
import { ProfilePageShell } from "@/components/profile/profile-page-shell";
import { BackgroundChoice } from "@/components/profile/background-choice";

export const metadata: Metadata = { title: "Profile background" };

export default async function ProfileBackgroundPage() {
  const profile = await getOrCreateProfile();
  if (!profile) redirect(`/sign-up?redirect_url=${encodeURIComponent("/profile/background")}`);

  return (
    <ProfilePageShell title="Profile background">
      <BackgroundChoice
        backgroundId={profile.background_id}
        backgroundUploadedUrl={profile.background_uploaded_url}
      />
    </ProfilePageShell>
  );
}
