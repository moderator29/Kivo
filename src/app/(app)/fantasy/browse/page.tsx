import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { FadeIn } from "@/components/ui/fade-in";
import { PublicLeaguesList } from "./public-leagues-list";
import { PUBLIC_FANTASY_LEAGUES_PAGE_SIZE } from "./constants";
import type { PublicFantasyLeagueListItem } from "../actions";

export const metadata: Metadata = { title: "Browse public leagues" };

export default async function BrowsePublicFantasyLeaguesPage() {
  const profile = await getOrCreateProfile();

  if (!profile) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 px-6 py-24 text-center">
        <p className="text-sm text-foreground-muted">Sign up to browse public fantasy leagues.</p>
        <Link
          href="/sign-up"
          className="kivo-gradient-prime rounded-xl px-5 py-2.5 text-sm font-semibold text-kivo-white transition-opacity hover:opacity-90"
        >
          Sign up
        </Link>
      </div>
    );
  }

  const supabase = createServerSupabaseClient();

  // Fetches one extra row beyond the page size so "hasMore" can be read
  // directly off the response, matching /leagues' loadMoreLeagues pattern.
  const { data, error } = await supabase.rpc("list_public_fantasy_leagues", {
    p_limit: PUBLIC_FANTASY_LEAGUES_PAGE_SIZE + 1,
    p_offset: 0,
  });

  const rows = data ?? [];
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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn className="flex flex-col gap-2">
        <Link
          href="/fantasy"
          className="flex w-fit items-center gap-1.5 text-xs font-medium text-foreground-subtle transition hover:text-foreground-muted"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Back to fantasy
        </Link>
        <h1 className="text-xl font-semibold text-foreground">Browse public leagues</h1>
        <p className="text-sm text-foreground-muted">
          Join any public league below with one tap. Private leagues still need an invite code from the owner.
        </p>
      </FadeIn>

      {error && <p className="text-xs text-critical">Couldn&apos;t load public leagues. Try again.</p>}

      <PublicLeaguesList initialLeagues={leagues} initialHasMore={hasMore} />
    </div>
  );
}
