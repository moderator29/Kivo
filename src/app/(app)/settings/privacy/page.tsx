import type { Metadata } from "next";
import { LogOut } from "lucide-react";
import { getOrCreateProfile } from "@/lib/profile";
import { signOut } from "@/app/(app)/session-actions";
import { ActivityPrivacyToggle } from "@/components/settings/activity-privacy-toggle";
import { OtherDevicesSection } from "@/components/settings/other-devices-section";
import { SettingsCard, SettingsPageShell } from "@/components/settings/settings-shell";
import { getSettingsSection } from "@/lib/settings-sections";
import { BlockedAccountsSection } from "@/components/settings/blocked-accounts-section";
import { getBlockedProfiles } from "@/lib/blocks";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";

export const metadata: Metadata = { title: getSettingsSection("privacy").label };

export default async function PrivacySettingsPage() {
  const profile = await getOrCreateProfile();
  // The (app) layout already guarantees a signed-in viewer with a real profile
  // row, so a null here is not a guest — it is a transient read failure between
  // that check and this one. See src/lib/guest-preview.ts.
  if (!profile) return <ProfileUnavailable />;

  const blocked = await getBlockedProfiles();

  return (
    <SettingsPageShell sectionId="privacy">
      <SettingsCard title="Activity">
        <ActivityPrivacyToggle initialShowActivityPublicly={profile.show_activity_publicly} />
      </SettingsCard>

      {/* Migration 0086. Sits above devices because it is the one on this page
          somebody actually comes looking for. */}
      <SettingsCard title="Blocked accounts" delay={0.04}>
        <BlockedAccountsSection blocked={blocked} />
      </SettingsCard>

      <SettingsCard title="Other devices" delay={0.08}>
        <OtherDevicesSection />
      </SettingsCard>

      <SettingsCard title="This device" delay={0.12}>
        <p className="text-xs text-foreground-subtle">
          Signs you out of KIVO on this device — including any other accounts you&apos;ve kept signed in for
          switching.
        </p>
        {/* A plain form posting to the server action, rather than a client
            component wrapping a button: the action already redirects, and this
            way the control still works with JavaScript disabled. */}
        <form action={signOut}>
          <button
            type="submit"
            className="kivo-glass-sharp kivo-focus flex w-fit items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-foreground transition-transform active:scale-95"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.75} />
            Sign out
          </button>
        </form>
      </SettingsCard>
    </SettingsPageShell>
  );
}
