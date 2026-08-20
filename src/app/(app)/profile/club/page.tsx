import type { Metadata } from "next";
import { getOrCreateProfile } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ProfilePageShell } from "@/components/profile/profile-page-shell";
import { ClubChoice } from "@/components/profile/club-choice";
import { readClubFacets, readClubs } from "@/lib/football/club-directory";
import { TEAM_PICKER_LIMIT } from "@/lib/profile-picker";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";

export const metadata: Metadata = { title: "Club you support" };

export default async function ProfileClubPage() {
  const profile = await getOrCreateProfile();
  // The (app) layout already guarantees a signed-in viewer with a real profile
  // row, so a null here is not a guest — it is a transient read failure between
  // that check and this one. See src/lib/guest-preview.ts.
  if (!profile) return <ProfileUnavailable />;

  // The opening list is a real answer, not a placeholder: `readClubs` with no
  // query returns the clubs most KIVO profiles follow first and the rest
  // alphabetically behind them (migration 0108). It used to be `order by name
  // limit 40`, which on the live database is forty reserve and youth sides —
  // a first screen with nothing on it anybody supports.
  const supabase = createServerSupabaseClient();
  const [page, facets] = await Promise.all([
    readClubs(supabase, { limit: TEAM_PICKER_LIMIT }),
    readClubFacets(supabase),
  ]);

  return (
    <ProfilePageShell
      title="Club you support"
      description="One club, the one you actually support. Following other clubs is separate — do that from any club's page, and follow as many as you like."
    >
      <ClubChoice
        initialTeams={page.clubs}
        initialRanked={page.ranked}
        loadFailed={page.failed}
        facets={facets}
        currentTeamId={profile.favourite_team_id}
      />
    </ProfilePageShell>
  );
}
