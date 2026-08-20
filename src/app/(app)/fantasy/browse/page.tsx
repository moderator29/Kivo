import type { Metadata } from "next";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readList } from "@/lib/query-result";
import { LoadFailed } from "@/components/ui/load-failed";
import { getOrCreateProfile } from "@/lib/profile";
import { FadeIn } from "@/components/ui/fade-in";
import { PublicLeaguesList } from "./public-leagues-list";
import { PUBLIC_FANTASY_LEAGUES_PAGE_SIZE } from "./constants";
import type { PublicFantasyLeagueListItem } from "../actions";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";

export const metadata: Metadata = { title: "Browse public leagues" };

export default async function BrowsePublicFantasyLeaguesPage() {
  const profile = await getOrCreateProfile();

  // The (app) layout already guarantees a signed-in viewer with a real profile
  // row, so a null here is not a guest — it is a transient read failure between
  // that check and this one. See src/lib/guest-preview.ts.
  if (!profile) return <ProfileUnavailable />;

  const supabase = createServerSupabaseClient();

  // Fetches one extra row beyond the page size so "hasMore" can be read
  // directly off the response, matching /leagues' loadMoreLeagues pattern.
  const outcome = readList(
    await supabase.rpc("list_public_fantasy_leagues", {
      p_limit: PUBLIC_FANTASY_LEAGUES_PAGE_SIZE + 1,
      p_offset: 0,
    }),
    "fantasy.publicLeagues",
  );

  const rows = outcome.rows;
  const leagues: PublicFantasyLeagueListItem[] = rows.slice(0, PUBLIC_FANTASY_LEAGUES_PAGE_SIZE).map((row) => ({
    id: row.id,
    name: row.name,
    seasonId: row.season_id,
    seasonLabel: [row.competition_short_name ?? row.competition_name, row.season_name].filter(Boolean).join(" · ") || row.season_name,
    maxTeams: row.max_teams,
    teamCount: Number(row.team_count),
    isFull: Number(row.team_count) >= row.max_teams,
  }));
  const hasMore = rows.length > PUBLIC_FANTASY_LEAGUES_PAGE_SIZE;

  return (
    <div className="kivo-page">
      <FadeIn className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Browse public leagues</h1>
        <p className="text-sm text-foreground-muted">
          Join any public league below with one tap. Private leagues still need an invite code from the owner.
        </p>
      </FadeIn>


      {/* The list's own empty state reads "no public leagues yet", which is a
          perfectly ordinary answer here and therefore a perfect hiding place
          for a failed RPC. The previous inline error line sat *above* that
          empty state and left it on screen, so the page said both things at
          once. */}
      {outcome.failed ? (
        <LoadFailed
          tone="section"
          title="Public leagues"
          description="KIVO couldn't read the public leagues just now. That's different from there being none — try again."
        />
      ) : (
        <PublicLeaguesList initialLeagues={leagues} initialHasMore={hasMore} />
      )}
    </div>
  );
}
