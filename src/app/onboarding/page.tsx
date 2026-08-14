import { redirect } from "next/navigation";
import Image from "next/image";
import kivoLogo from "../../../public/brand/kivo-logo.png";
import { getOrCreateProfile } from "@/lib/profile";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";

export default async function OnboardingPage() {
  const profile = await getOrCreateProfile();

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
