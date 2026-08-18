import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { getOrCreateProfile } from "@/lib/profile";
import { signInHref } from "@/lib/auth";
import { signOut } from "@/app/(app)/session-actions";
import { ActivityPrivacyToggle } from "@/components/settings/activity-privacy-toggle";
import { OtherDevicesSection } from "@/components/settings/other-devices-section";
import { SettingsCard, SettingsPageShell } from "@/components/settings/settings-shell";
import { getSettingsSection } from "@/lib/settings-sections";

export const metadata: Metadata = { title: getSettingsSection("privacy").label };

export default async function PrivacySettingsPage() {
  const profile = await getOrCreateProfile();
  if (!profile) redirect(await signInHref());

  return (
    <SettingsPageShell sectionId="privacy">
      <SettingsCard title="Activity">
        <ActivityPrivacyToggle initialShowActivityPublicly={profile.show_activity_publicly} />
      </SettingsCard>

      <SettingsCard title="Other devices" delay={0.04}>
        <OtherDevicesSection />
      </SettingsCard>

      <SettingsCard title="This device" delay={0.08}>
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
