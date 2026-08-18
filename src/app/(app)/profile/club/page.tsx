import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOrCreateProfile } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ProfilePageShell } from "@/components/profile/profile-page-shell";
import { ClubChoice } from "@/components/profile/club-choice";
import { TEAM_PICKER_LIMIT, type PickerTeam } from "@/lib/profile-picker";

export const metadata: Metadata = { title: "Club you support" };

export default async function ProfileClubPage() {
  const profile = await getOrCreateProfile();
  if (!profile) redirect(`/sign-up?redirect_url=${encodeURIComponent("/profile/club")}`);

  // The alphabetical head of the table, so the picker opens with something
  // real rather than an empty box waiting to be typed into. `searchTeams`
  // takes over from the first keystroke.
  const supabase = createServerSupabaseClient();
  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, short_name, crest_url, country")
    .order("name", { ascending: true })
    .limit(TEAM_PICKER_LIMIT);

  return (
    <ProfilePageShell
      title="Club you support"
      description="One club, the one you actually support. Following other clubs is separate — do that from any club's page, and follow as many as you like."
    >
      <ClubChoice initialTeams={(teams ?? []) as PickerTeam[]} currentTeamId={profile.favourite_team_id} />
    </ProfilePageShell>
  );
}
