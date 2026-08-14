import type { Metadata } from "next";
import Link from "next/link";
import { CircleUserRound } from "lucide-react";
import { getOrCreateProfile } from "@/lib/profile";
import { UsernameEditor } from "@/components/profile/username-editor";
import { FadeIn } from "@/components/ui/fade-in";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const profile = await getOrCreateProfile();

  if (!profile) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 px-6 py-24 text-center">
        <CircleUserRound className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
        <p className="text-sm text-foreground-muted">Sign up to set up your KIVO profile.</p>
        <Link
          href="/sign-up"
          className="kivo-gradient-prime rounded-xl px-5 py-2.5 text-sm font-semibold text-kivo-white transition-opacity hover:opacity-90"
        >
          Sign up
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn className="kivo-glass flex items-center gap-4 rounded-2xl p-5">
        <div className="kivo-gradient-prime flex h-16 w-16 shrink-0 items-center justify-center rounded-full">
          <CircleUserRound className="h-8 w-8 text-kivo-white" strokeWidth={1.5} />
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold text-foreground">{profile.display_name || "Your profile"}</h1>
          <UsernameEditor username={profile.username} />
        </div>
      </FadeIn>

      <FadeIn delay={0.08} className="kivo-glass rounded-2xl p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Football identity</h2>
        <p className="mt-2 text-sm text-foreground-muted">
          Favourite clubs, players, prediction history, fantasy rank and badges will live here as those systems come
          online.
        </p>
      </FadeIn>
    </div>
  );
}
