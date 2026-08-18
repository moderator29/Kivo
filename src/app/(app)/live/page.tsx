import type { Metadata } from "next";
import { Radio } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { triggerLiveScoresRefresh } from "@/app/admin/data-health/actions";
import { FadeIn } from "@/components/ui/fade-in";
import { NoDataYet } from "@/components/ui/no-data-yet";
import { InlineSyncButton } from "@/components/admin/inline-sync-button";
import { LiveFixtureList } from "@/components/matches/live-fixture-list";
import { getViewerFantasyRosterBySeasons } from "@/lib/football/fantasy-lineup-crossref";
import { getNavItem } from "@/lib/navigation";

const item = getNavItem("live");

export const metadata: Metadata = { title: item.label };

export default async function LivePage() {
  const supabase = createServerSupabaseClient();
  const profile = await getOrCreateProfile();
  const canRefreshLive = canManageFootballData(profile?.role);

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

  const fixtureSelect = `id, kickoff_at, status, home_score, away_score, minute_elapsed, season_id,
       home_team:teams!fixtures_home_team_id_fkey(name, crest_url),
       away_team:teams!fixtures_away_team_id_fkey(name, crest_url),
       competition:competitions(id, name, short_name)`;

  const { data: liveFixtures } = await supabase
    .from("fixtures")
    .select(fixtureSelect)
    .in("status", ["live", "halftime"])
    .order("kickoff_at", { ascending: true });

  const hasLiveFixtures = (liveFixtures?.length ?? 0) > 0;

  const { data: todayFixtures } = hasLiveFixtures
    ? { data: null }
    : await supabase
        .from("fixtures")
        .select(fixtureSelect)
        .gte("kickoff_at", startOfDay.toISOString())
        .lt("kickoff_at", endOfDay.toISOString())
        .order("kickoff_at", { ascending: true });

  const hasTodayFixtures = (todayFixtures?.length ?? 0) > 0;

  if (!hasLiveFixtures && !hasTodayFixtures) {
    return (
      <NoDataYet icon={<item.icon className="h-6 w-6" strokeWidth={1.75} />} title={item.label} description={item.comingSoonDescription ?? "Nothing synced yet."} />
    );
  }

  // RECOMMENDATIONS.md item 297: real per-fixture "N of your fantasy players
  // are in this match" count for a signed-in user with a fantasy team —
  // reuses the exact fantasy_rosters -> lineups join chain item 294
  // establishes for Match Centre (getViewerFantasyRosterBySeasons),
  // aggregated to a count per fixture instead of a per-player badge. Stays
  // empty for a guest, or a viewer with no fantasy team in any of these
  // fixtures' seasons — LiveFixtureList's row then renders exactly as it
  // does today.
  const displayedFixtures = hasLiveFixtures ? liveFixtures ?? [] : todayFixtures ?? [];
  const fantasyMatchCounts: Record<string, number> = {};
  if (profile) {
    const seasonIds = [...new Set(displayedFixtures.map((f) => f.season_id))];
    const rosterBySeasonId = await getViewerFantasyRosterBySeasons(supabase, profile.id, seasonIds);
    if (rosterBySeasonId.size > 0) {
      const { data: lineupRows } = await supabase
        .from("lineups")
        .select("fixture_id, player_id")
        .in(
          "fixture_id",
          displayedFixtures.map((f) => f.id),
        );

      const lineupPlayerIdsByFixture = new Map<string, string[]>();
      for (const row of lineupRows ?? []) {
        const list = lineupPlayerIdsByFixture.get(row.fixture_id);
        if (list) list.push(row.player_id);
        else lineupPlayerIdsByFixture.set(row.fixture_id, [row.player_id]);
      }

      for (const fixture of displayedFixtures) {
        const roster = rosterBySeasonId.get(fixture.season_id);
        const playerIds = roster ? lineupPlayerIdsByFixture.get(fixture.id) : undefined;
        if (!roster || !playerIds) continue;
        const count = playerIds.filter((playerId) => roster.has(playerId)).length;
        if (count > 0) fantasyMatchCounts[fixture.id] = count;
      }
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Live Center</h1>
          <p className="text-sm text-foreground-muted">
            {hasLiveFixtures
              ? "Matches in progress right now, synced from API-Football."
              : "Nothing in play right now. Here's what's on today."}
          </p>
        </div>
        {/* RECOMMENDATIONS.md item 51: the real guard FOOTBALL_LIVE_POLLING_ENABLED
            sits in front of now — triggerLiveScoresRefresh (src/app/admin/data-health/
            actions.ts) checks the flag itself and returns a clear "disabled until a
            paid tier exists" message rather than spending quota, so this button is
            always visible to admins but only does real work once that flag is on. */}
        {canRefreshLive && <InlineSyncButton label="Refresh live scores" action={triggerLiveScoresRefresh} />}
      </FadeIn>

      {hasLiveFixtures && liveFixtures && (
        <FadeIn delay={0.05} className="kivo-glass-brand rounded-2xl p-5">
          <div className="mb-3 flex items-center gap-2">
            <Radio className="h-4 w-4 text-live" strokeWidth={2} />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Live now</h2>
          </div>
          {/* No live dot here — redundant with this section's own Radio-icon
              header, unlike "Today's fixtures" below where a fixture could
              flip to live mid-session via Realtime with no other cue on the
              page. */}
          <LiveFixtureList fixtures={liveFixtures} showLiveDot={false} fantasyMatchCounts={fantasyMatchCounts} />
        </FadeIn>
      )}

      {!hasLiveFixtures && hasTodayFixtures && todayFixtures && (
        <FadeIn delay={0.05} className="kivo-glass rounded-2xl p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-foreground-muted">Today&apos;s fixtures</h2>
          <LiveFixtureList fixtures={todayFixtures} fantasyMatchCounts={fantasyMatchCounts} />
        </FadeIn>
      )}
    </div>
  );
}
