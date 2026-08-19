import type { Metadata } from "next";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { viewerIsSignedIn } from "@/lib/guest-preview";
import { canManageFootballData } from "@/lib/admin";
import { getActiveProviderStatus } from "@/lib/football";
import { triggerLiveScoresRefresh } from "@/app/admin/data-health/actions";
import { FadeIn } from "@/components/ui/fade-in";
import { NoDataYet } from "@/components/ui/no-data-yet";
import { LoadFailed } from "@/components/ui/load-failed";
import { readList } from "@/lib/query-result";
import { InlineSyncButton } from "@/components/admin/inline-sync-button";
import { LiveCentreSections } from "@/components/matches/live-centre-sections";
import { LiveFreshnessNote } from "@/components/football/live-freshness-note";
import type { LiveListFixture } from "@/components/matches/live-fixture-list";
import { getViewerFantasyRosterBySeasons } from "@/lib/football/fantasy-lineup-crossref";
import { getNavItem } from "@/lib/navigation";
import { scheduleAutoSyncIfStale } from "@/lib/football/auto-sync";
import { getCompetitionRankingSignals } from "@/lib/football/competition-ranking";
import { resolveTimeZone, startOfDayInTimeZone } from "@/lib/timezone";

/** The list rows this page works with: everything LiveCentreSections renders,
 * plus the season the fantasy cross-reference below needs. */
type LivePageFixture = LiveListFixture & { season_id: string };

const item = getNavItem("live");

export const metadata: Metadata = { title: item.label };

/**
 * KIVO_NEXT_GEN KN-16: neither of this page's fixture queries had a `LIMIT`,
 * against a table that grows with every synced competition-day — every other
 * list surface in the app is bounded (RECOMMENDATIONS.md items 111-113
 * established the convention) and these were the exceptions.
 *
 * 120 is not arbitrary: a genuinely busy football Saturday across every
 * European league runs to well under a hundred fixtures, so this is a ceiling
 * that a real day does not reach rather than a page size a user would notice.
 * It also bounds what the Realtime subscription downstream has to watch
 * (KN-6). Live fixtures are fetched under their own ceiling so a busy day of
 * scheduled matches can never crowd an in-progress one out of the list.
 */
const LIVE_FIXTURES_LIMIT = 60;
const TODAY_FIXTURES_LIMIT = 120;

export default async function LivePage() {
  // Founder instruction (2026-08-18): football data arrives without anybody
  // pressing anything. This asks for a sync only if what this page is about
  // to render is already stale, and the work runs *after* the response is
  // sent — a provider outage cannot slow this page down or break it. Every
  // guard (staleness threshold, attempt cooldown, the sync lease, the quota
  // floor) lives in one place: src/lib/football/auto-sync.ts. It is not live
  // scores, and that file says so in as many words.
  scheduleAutoSyncIfStale("live");

  const supabase = createServerSupabaseClient();
  const profile = await getOrCreateProfile();
  const canRefreshLive = canManageFootballData(profile?.role);

  // KN-32: "today's fixtures" means the viewer's today. Under the previous
  // `setUTCHours(0,0,0,0)` a 00:30 kickoff in Lagos (UTC+1, the stated launch
  // market) belonged to the previous UTC day and dropped off this page for
  // exactly the audience it was nearest to. Falls back to UTC — explicitly, via
  // resolveTimeZone — for anyone who has not stated a zone.
  const { timeZone: viewerTimeZone } = resolveTimeZone(profile?.timezone);
  const startOfDay = startOfDayInTimeZone(viewerTimeZone);
  // Next local midnight, found by stepping well past it and re-flooring, so a
  // DST transition inside the window cannot make the day 23 or 25 hours long.
  const endOfDay = startOfDayInTimeZone(viewerTimeZone, new Date(startOfDay.getTime() + 36 * 60 * 60 * 1000));

  const fixtureSelect = `id, kickoff_at, status, home_score, away_score, minute_elapsed, season_id,
       home_team:teams!fixtures_home_team_id_fkey(name, crest_url),
       away_team:teams!fixtures_away_team_id_fkey(name, crest_url),
       competition:competitions(id, name, short_name, logo_url, country)`;

  // KIVO_NEXT_GEN KN-5: one list, not two mutually-exclusive ones. Both queries
  // still exist because they answer different questions — "what is in play
  // right now" is not date-bounded (a late kickoff is still live after
  // midnight UTC) and "what is on today" is — but their results are merged and
  // handed down as a single set. The client partitions it by current status, so
  // a kickoff or a full-time whistle actually moves a row between sections
  // instead of restyling it in place under the wrong heading.
  const [liveResult, todayResult] = await Promise.all([
    supabase
      .from("fixtures")
      .select(fixtureSelect)
      .in("status", ["live", "halftime"])
      .order("kickoff_at", { ascending: true })
      .limit(LIVE_FIXTURES_LIMIT),
    supabase
      .from("fixtures")
      .select(fixtureSelect)
      .gte("kickoff_at", startOfDay.toISOString())
      .lt("kickoff_at", endOfDay.toISOString())
      .order("kickoff_at", { ascending: true })
      .limit(TODAY_FIXTURES_LIMIT),
  ]);

  const liveOutcome = readList(liveResult, "live.inPlay");
  const todayOutcome = readList(todayResult, "live.today");

  // Either failing sinks the page rather than half of it. These two lists are
  // merged into one set the client then partitions by status, so a surviving
  // half does not render as "the live matches, minus a few" — it renders as a
  // complete and confident list that happens to be missing rows nobody can
  // see are missing. On a page whose entire promise is "this is what is
  // happening right now", that is the worst available outcome.
  if (liveOutcome.failed || todayOutcome.failed) {
    return (
      <LoadFailed
        title={item.label}
        icon={<item.icon className="h-6 w-6" strokeWidth={1.75} />}
        description="KIVO couldn't read what's in play just now. That's different from nothing being on — try again."
      />
    );
  }

  const byId = new Map<string, LivePageFixture>();
  for (const fixture of [...liveOutcome.rows, ...todayOutcome.rows]) {
    // A live fixture that kicked off today appears in both result sets; the
    // first write wins and they carry identical rows either way.
    if (!byId.has(fixture.id)) byId.set(fixture.id, fixture);
  }
  const displayedFixtures = [...byId.values()].sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at));

  if (displayedFixtures.length === 0) {
    // Two different facts hid behind one sentence here, and the old copy —
    // "Nothing is live and nothing is synced for today yet" — asserted both at
    // once so a reader could not tell which was true:
    //
    //   * KIVO has football, and none of it is on today. A quiet Tuesday. The
    //     product is working exactly as it should.
    //   * KIVO has no fixtures at all, for any date. Coverage has not started
    //     here yet, and there is a real reason for that which /transparency
    //     spells out.
    //
    // The first reads as a broken app if it is described as the second, and
    // the second reads as a promise if it is described as the first. KIVO can
    // tell them apart for the price of one `head: true` count that reads no
    // rows, so it does.
    const anyFixtures = await supabase
      .from("fixtures")
      .select("id", { count: "exact", head: true })
      .limit(1);
    // A failed count is a third state again: KIVO does not know which of the
    // two it is. It says the smaller, certain thing — nothing is on today —
    // rather than guessing at coverage it could not read.
    const syncedSomething = anyFixtures.error === null && (anyFixtures.count ?? 0) > 0;

    return (
      <NoDataYet
        icon={<item.icon className="h-6 w-6" strokeWidth={1.75} />}
        title={item.label}
        description={
          syncedSomething
            ? "No match is in play right now, and nothing else kicks off today."
            : (item.emptyDescription ?? "Nothing to show here yet.")
        }
      />
    );
  }

  // RECOMMENDATIONS.md item 297: real per-fixture "N of your fantasy players
  // are in this match" count for a signed-in user with a fantasy team —
  // reuses the exact fantasy_rosters -> lineups join chain item 294
  // establishes for Match Centre (getViewerFantasyRosterBySeasons),
  // aggregated to a count per fixture instead of a per-player badge. Stays
  // empty for a guest, or a viewer with no fantasy team in any of these
  // fixtures' seasons — the fixture row then renders exactly as it does today.
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

  // Which competition leads each section, from the same four real signals
  // /matches uses — the viewer's own favourites, KIVO's configured coverage
  // scope, real follower counts, then kickoff order. Read once here rather
  // than inside the client component: none of it is derivable from the
  // fixtures, and the Realtime subscription downstream must not have to
  // re-fetch it on every score change. See src/lib/football/competition-tier.ts.
  const rankingSignals = await getCompetitionRankingSignals(
    supabase,
    displayedFixtures
      .map((fixture) => fixture.competition?.id ?? null)
      .filter((id): id is string => id !== null),
    profile?.id ?? null,
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn className="flex items-start justify-between gap-3">
        {/* Title and freshness are one block, so the row's justify-between
            keeps the admin action on the right rather than pushing the note
            into the middle of the header. */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="text-xl font-semibold text-foreground">Live Center</h1>
          {/* Said at the top, not the bottom. A fan reading a scoreline needs
              to know how current it is before they read it, not after. */}
          <LiveFreshnessNote />
        </div>
        {/* RECOMMENDATIONS.md item 51: the real guard FOOTBALL_LIVE_POLLING_ENABLED
            sits in front of now — triggerLiveScoresRefresh (src/app/admin/data-health/
            actions.ts) checks the flag itself and returns a clear "disabled until a
            paid tier exists" message rather than spending quota, so this button is
            always visible to admins but only does real work once that flag is on. */}
        {canRefreshLive && <InlineSyncButton label="Refresh live scores" action={triggerLiveScoresRefresh} />}
      </FadeIn>

      <LiveCentreSections
        fixtures={displayedFixtures}
        fantasyMatchCounts={fantasyMatchCounts}
        // KIVO_NEXT_GEN KN-8: read the provider actually in use rather than
        // asserting one. getActiveProviderStatus() is the side-effect-free
        // mirror of the real selection order (the cron route uses it for
        // exactly this reason) and returns null when none is configured, in
        // which case the copy simply doesn't name a source.
        providerLabel={getActiveProviderStatus().label}
        rankingSignals={rankingSignals}
        signedIn={viewerIsSignedIn(profile)}
      />
    </div>
  );
}
