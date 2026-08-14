import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { SignOutButton } from "@clerk/nextjs";
import { CircleUserRound, LogOut } from "lucide-react";
import { getOrCreateProfile } from "@/lib/profile";
import { UsernameEditor } from "@/components/profile/username-editor";

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

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <h1 className="text-lg font-semibold text-foreground">Settings</h1>

      <div className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Account</h2>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-foreground-subtle">Email</span>
          <span className="text-sm text-foreground">{email ?? "No email on file"}</span>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-foreground-subtle">Username</span>
          <UsernameEditor username={profile.username} />
        </div>
      </div>

      <div className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Session</h2>
        <p className="text-sm text-foreground-muted">Sign out of KIVO on this device.</p>
        <SignOutButton redirectUrl="/">
          <button className="kivo-glass-sharp flex w-fit items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-foreground">
            <LogOut className="h-4 w-4" strokeWidth={2} />
            Sign out
          </button>
        </SignOutButton>
      </div>
    </div>
  );
}
