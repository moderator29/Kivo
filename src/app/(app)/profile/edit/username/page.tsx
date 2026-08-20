import type { Metadata } from "next";
import { getOrCreateProfile } from "@/lib/profile";
import { ProfilePageShell } from "@/components/profile/profile-page-shell";
import { HandleEditor } from "@/components/profile/handle-editor";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";

export const metadata: Metadata = { title: "Your handle" };

export default async function EditUsernamePage() {
  const profile = await getOrCreateProfile();
  // The (app) layout already guarantees a signed-in viewer with a real profile
  // row, so a null here is not a guest — it is a transient read failure between
  // that check and this one. See src/lib/guest-preview.ts.
  if (!profile) return <ProfileUnavailable />;

  return (
    <ProfilePageShell title="Username">
      <HandleEditor username={profile.username} />
    </ProfilePageShell>
  );
}
