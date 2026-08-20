import type { Metadata } from "next";
import { Mail, AtSign } from "lucide-react";
import { getOrCreateProfile } from "@/lib/profile";
import { getAuthUser } from "@/lib/auth";
import { UsernameEditor } from "@/components/profile/username-editor";
import { ProfileDetailsEditor } from "@/components/settings/profile-details-editor";
import { SettingsCard, SettingsPageShell } from "@/components/settings/settings-shell";
import { getSettingsSection } from "@/lib/settings-sections";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";

export const metadata: Metadata = { title: getSettingsSection("account").label };

export default async function AccountSettingsPage() {
  const profile = await getOrCreateProfile();
  // The (app) layout already guarantees a signed-in viewer with a real profile
  // row, so a null here is not a guest — it is a transient read failure between
  // that check and this one. See src/lib/guest-preview.ts.
  if (!profile) return <ProfileUnavailable />;

  // Email is the one identity field KIVO deliberately does NOT copy into
  // `profiles` (see ARCHITECTURE.md) — Supabase Auth owns it, so it is read
  // off the verified auth user at render time rather than from the profile row.
  const authUser = await getAuthUser();

  return (
    <SettingsPageShell sectionId="account">
      <SettingsCard title="Email" description="Owned by your sign-in, not editable here.">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Mail className="h-4 w-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
          {authUser?.email ?? "No email on file"}
        </p>
      </SettingsCard>

      <SettingsCard title="Username" description="Your @handle across KIVO." delay={0.04}>
        <p className="flex items-center gap-1.5 text-xs text-foreground-subtle">
          <AtSign className="h-3 w-3" strokeWidth={2} />
          Lowercase letters, numbers and underscores.
        </p>
        <UsernameEditor username={profile.username} />
      </SettingsCard>

      <SettingsCard title="Profile details" description="Shown on your public profile." delay={0.08}>
        <ProfileDetailsEditor bio={profile.bio} country={profile.country} />
      </SettingsCard>
    </SettingsPageShell>
  );
}
