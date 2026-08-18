import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOrCreateProfile } from "@/lib/profile";
import { ProfilePageShell } from "@/components/profile/profile-page-shell";
import { CountryEditor } from "@/components/profile/country-editor";

export const metadata: Metadata = { title: "Your country" };

export default async function EditCountryPage() {
  const profile = await getOrCreateProfile();
  if (!profile) redirect(`/sign-up?redirect_url=${encodeURIComponent("/profile/edit/country")}`);

  return (
    <ProfilePageShell
      title="Country"
      description="Shown on your profile. Never used to guess your time zone — that is asked for separately in Settings."
    >
      <CountryEditor country={profile.country} />
    </ProfilePageShell>
  );
}
