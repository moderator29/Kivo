import { redirect } from "next/navigation";
import Image from "next/image";
import { auth } from "@clerk/nextjs/server";
import kivoLogo from "../../../public/brand/kivo-logo.png";
import { getOrCreateProfile } from "@/lib/profile";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import { isClerkConfigured } from "@/lib/clerk";

// See src/app/(app)/layout.tsx for why this must be explicit rather than implied by
// the auth check alone.
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  // Resource-level auth boundary — see src/proxy.ts for why this isn't a middleware
  // matcher. Unconfigured Clerk has no session to check, so skip straight to sign-in.
  if (!isClerkConfigured()) {
    redirect("/sign-in");
  }
  await auth.protect();

  const profile = await getOrCreateProfile();

  // auth.protect() above already guarantees a signed-in user; a null profile here
  // means row creation itself failed (see lib/profile.ts), not a missing session.
  if (!profile) {
    redirect("/sign-in");
  }

  if (profile.onboarding_completed) {
    redirect("/home");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-4 py-12">
      <Image src={kivoLogo} alt="KIVO" width={96} height={96} className="h-24 w-24" priority />
      <div className="flex w-full max-w-sm flex-col gap-2 text-center">
        <h1 className="text-xl font-semibold text-foreground">Pick your KIVO handle</h1>
        <p className="text-sm text-foreground-muted">
          This is how other fans will see you in Match Rooms and the feed. You can change it later.
        </p>
      </div>
      <OnboardingForm defaultUsername={profile.username} />
    </div>
  );
}
