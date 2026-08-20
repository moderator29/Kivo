import type { Metadata } from "next";
import { getOrCreateProfile } from "@/lib/profile";
import { ProfilePageShell } from "@/components/profile/profile-page-shell";
import { CountryEditor } from "@/components/profile/country-editor";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";

export const metadata: Metadata = { title: "Your country" };

export default async function EditCountryPage() {
  const profile = await getOrCreateProfile();
  // The (app) layout already guarantees a signed-in viewer with a real profile
  // row, so a null here is not a guest — it is a transient read failure between
  // that check and this one. See src/lib/guest-preview.ts.
  if (!profile) return <ProfileUnavailable />;

  return (
    <ProfilePageShell
      title="Country"
      description="Shown on your profile. Never used to guess your time zone — that is asked for separately in Settings."
    >
      <CountryEditor country={profile.country} />
    </ProfilePageShell>
  );
}
