import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { getOrCreateProfile } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
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

  // Only offer the favourite-team step when there's real, synced data to
  // pick from — an empty picker on a brand-new environment would be a dead
  // end, not a personalization step.
  const supabase = createServerSupabaseClient();
  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, short_name, crest_url")
    .order("name", { ascending: true })
    .limit(60);

  return (
    <div className="relative flex min-h-screen flex-col items-center overflow-hidden bg-background px-4 py-8">
      <div className="kivo-aurora" aria-hidden="true">
        <span className="kivo-aurora-blob kivo-aurora-blob--cyan" />
        <span className="kivo-aurora-blob kivo-aurora-blob--violet" />
        <span className="kivo-aurora-blob kivo-aurora-blob--magenta" />
      </div>

      <OnboardingFlow defaultUsername={profile.username} availableTeams={teams ?? []} />
    </div>
  );
}
