import { redirect } from "next/navigation";
import { getOrCreateProfile } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { resolveAvatarSrc } from "@/lib/kivo-assets";

// See src/app/(app)/layout.tsx for why this must be explicit rather than implied by
// the auth check alone.
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  // Resource-level auth boundary — see src/proxy.ts for why this isn't a middleware
  // matcher. Expressed as "no profile means no session" rather than a call into a
  // specific auth provider's SDK: getOrCreateProfile() is the one place that knows
  // who the viewer is, and it already returns null for a signed-out (or
  // unconfigured-auth) request, so this guard stays correct while the provider
  // underneath it is being swapped out.
  const profile = await getOrCreateProfile();
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

      <OnboardingFlow
        defaultUsername={profile.username}
        availableTeams={teams ?? []}
        // The KIVO avatar this profile was assigned at creation
        // (randomKivoAvatarId, in getOrCreateProfile) — passed so the
        // completion screen can show the user their own real avatar even if
        // the post-write read comes back without one.
        avatarSrc={resolveAvatarSrc(profile)}
      />
    </div>
  );
}
