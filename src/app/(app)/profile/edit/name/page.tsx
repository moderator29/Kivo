import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOrCreateProfile } from "@/lib/profile";
import { ProfilePageShell } from "@/components/profile/profile-page-shell";
import { NameEditor } from "@/components/profile/name-editor";

export const metadata: Metadata = { title: "Your name" };

export default async function EditNamePage() {
  const profile = await getOrCreateProfile();
  if (!profile) redirect(`/sign-up?redirect_url=${encodeURIComponent("/profile/edit/name")}`);

  return (
    <ProfilePageShell title="Name">
      <NameEditor displayName={profile.display_name} />
    </ProfilePageShell>
  );
}
