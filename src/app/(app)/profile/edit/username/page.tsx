import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOrCreateProfile } from "@/lib/profile";
import { ProfilePageShell } from "@/components/profile/profile-page-shell";
import { HandleEditor } from "@/components/profile/handle-editor";

export const metadata: Metadata = { title: "Your handle" };

export default async function EditUsernamePage() {
  const profile = await getOrCreateProfile();
  if (!profile) redirect(`/sign-up?redirect_url=${encodeURIComponent("/profile/edit/username")}`);

  return (
    <ProfilePageShell title="Username">
      <HandleEditor username={profile.username} />
    </ProfilePageShell>
  );
}
