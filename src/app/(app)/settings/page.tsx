import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { SignOutButton } from "@clerk/nextjs";
import { CircleUserRound, LogOut, Mail, AtSign } from "lucide-react";
import { getOrCreateProfile } from "@/lib/profile";
import { UsernameEditor } from "@/components/profile/username-editor";
import { FadeIn } from "@/components/ui/fade-in";
import { getNotificationPreferences } from "@/app/(app)/settings/actions";
import { NotificationPreferencesPanel } from "@/components/settings/notification-preferences-panel";
import { ProfileDetailsEditor } from "@/components/settings/profile-details-editor";
import { DeleteAccountSection } from "@/components/settings/delete-account-section";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const profile = await getOrCreateProfile();

  if (!profile) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 px-6 py-24 text-center">
        <CircleUserRound className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
        <p className="text-sm text-foreground-muted">Sign up to manage your settings.</p>
        <Link
          href="/sign-up"
          className="kivo-gradient-prime rounded-xl px-5 py-2.5 text-sm font-semibold text-kivo-white transition-opacity hover:opacity-90"
        >
          Sign up
        </Link>
      </div>
    );
  }

  const [user, notificationPreferences] = await Promise.all([currentUser(), getNotificationPreferences(profile.id)]);
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn>
        <h1 className="text-lg font-semibold text-foreground">Settings</h1>
      </FadeIn>

      <FadeIn delay={0.08} className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Account</h2>

        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-xs text-foreground-subtle">
            <Mail className="h-3 w-3" strokeWidth={2} />
            Email
          </span>
          <span className="text-sm text-foreground">{email ?? "No email on file"}</span>
        </div>

        <div className="flex flex-col gap-1 border-t border-white/5 pt-3">
          <span className="flex items-center gap-1.5 text-xs text-foreground-subtle">
            <AtSign className="h-3 w-3" strokeWidth={2} />
            Username
          </span>
          <UsernameEditor username={profile.username} />
        </div>
      </FadeIn>

      <FadeIn delay={0.16} className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Profile</h2>
        <ProfileDetailsEditor bio={profile.bio} country={profile.country} />
      </FadeIn>

      <FadeIn delay={0.24} className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Notifications</h2>
        <NotificationPreferencesPanel initial={notificationPreferences} />
      </FadeIn>

      <FadeIn delay={0.32} className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Session</h2>
        <p className="text-sm text-foreground-muted">Sign out of KIVO on this device.</p>
        <SignOutButton redirectUrl="/">
          <button className="kivo-glass-sharp flex w-fit items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-foreground transition-transform active:scale-95">
            <LogOut className="h-4 w-4" strokeWidth={2} />
            Sign out
          </button>
        </SignOutButton>
      </FadeIn>

      <FadeIn delay={0.4} className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Danger zone</h2>
        <DeleteAccountSection />
      </FadeIn>
    </div>
  );
}
