import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { LastSyncedNote } from "@/components/football/last-synced-note";
import { TrackView } from "@/components/ui/track-view";
import { getLastSyncedAt } from "@/lib/football/last-synced";
import { readRow } from "@/lib/query-result";
import { viewerIsSignedIn } from "@/lib/guest-preview";
import { TopScorersPanel } from "@/components/football/top-scorers-panel";
import { ShareCardPanel } from "@/components/share/share-card-panel";
import { MatchList, MatchListRow } from "@/components/matches/match-list";
import { CompetitionHeader } from "@/components/leagues/competition-header";
import { CompetitionTabs, type CompetitionSection } from "@/components/leagues/competition-tabs";
import { CompetitionClubs, type CompetitionClub } from "@/components/leagues/competition-clubs";
import { StandingsTable } from "@/components/standings/standings-table";
import { StandingsEmpty } from "@/components/standings/standings-empty";
import { buildStandingsGroups, computeStandingsForm, type StandingsSnapshotRow } from "@/lib/football/standings-table";
import { resolveFixtureResult } from "@/lib/football/form-engine";
import type { FormResult } from "@/lib/football/results";
import type { FixtureStatus } from "@/lib/football/fixture-status";

/**
 * A competition's page.
 *
 * Rebuilt around one idea the previous version did not have: a competition is
 * not a stack of every section KIVO could render, it is a **table** with the
 * rest of the season a tap away. The old page scrolled through standings,
 * fixtures, results, scorers and a coverage matrix in one column, so a reader
 * on a phone met an empty table and then kept scrolling past four more
 * headings to find out whether anything on the page had content. Every
 * reference product puts these behind one tab rail, and KIVO now has exactly
 * one of those (`SectionTabs`, docs/UI_PRIMITIVES.md) — the same rail Match
 * Centre and the team pages use.
 *
 * ## Sections are built from what exists
 *
 * A tab is omitted rather than rendered empty, per the rail's own contract:
 * a competition with no finished matches has no Results tab at all, which is
 * a truer statement than a Results tab containing a shrug.
 *
 * **The table is the exception, and deliberately.** It is always the first
 * tab, even with no rows, because "there is no table" is the single thing a
 * fan most wants to know about a competition, and hiding the section would
 * turn a plain fact into a mystery. Its empty state says which of three
 * football reasons applies and offers the fixtures in one tap.
 *
 * ## Nothing here is addressed to staff
 *
 * The empty table used to carry a "Sync standings" button for admins. It was
 * correctly role-gated and it was still in the wrong place: a competition page
 * is a fan's page, and a control a fan cannot use is one more piece of the
 * product talking about itself. The bulk version lives in the admin area,
 * where the person who can act on it already is. What the block says to a fan
 * — that there is no table, and why in football terms — is unchanged.
 *
 * ## Everything on this page is a row KIVO holds
 *
 * No position is derived, no zone is inferred from a rank, no scorer is
 * invented and no club is added to round a league out to its expected size.
 * The two derivations that do happen — goal difference, and a club's movement
 * since it last played — are arithmetic over stored rows, and the second is
 * read from `standings_snapshots`, which is a record of what KIVO showed at
 * the time.
 */

/** How many fixtures each list shows. Enough to read a run of the season
 * without turning a tab into an archive. */
const FIXTURE_LIMIT = 20;

/**
 * How many finished fixtures the form guide reads. A form column needs five
 * results per club, so a 20-club league needs roughly ten rounds — 200
 * fixtures is comfortably past that for every league KIVO covers, and it is a
 * hard bound rather than "the season", which for a 380-match league would be
 * a large read for one column of five letters.
 */
const FORM_FIXTURE_LIMIT = 200;

/**
 * How many of a season's fixtures the club list is derived from, **ordered
 * from the start of the season**. Every club in a competition appears within
 * its first couple of rounds, so the earliest fixtures are the cheapest
 * complete answer to "who is in this".
 */
const CLUB_FIXTURE_LIMIT = 200;

/** Snapshots read per season for the movement column. Append-only and written
 * only when a table actually changed (migration 0072), so a season's worth for
 * a 20-club league is in the hundreds. */
const SNAPSHOT_LIMIT = 1200;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = createServerSupabaseClient();
  const { data: competition } = await supabase
    .from("competitions")
    .select("name, short_name")
    .eq("id", id)
    .maybeSingle();
  const name = (competition?.short_name ?? competition?.name) || null;
  if (!name) return { title: "League" };

  const description = `${name} standings, fixtures, and results on KIVO.`;
  return {
    title: name,
    description,
    openGraph: { title: name, description },
    twitter: { title: name, description },
  };
}

export default async function LeagueDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { id } = await params;
  const { season: requestedSeasonId } = await searchParams;
  const supabase = createServerSupabaseClient();
  const profile = await getOrCreateProfile();

  const [competitionResult, isFollowing, standingsLastSyncedAt] = await Promise.all([
    supabase
      .from("competitions")
      .select("id, name, short_name, country, logo_url, seasons(id, name, is_current)")
      .eq("id", id)
      .maybeSingle(),
    profile
      ? supabase
          .from("follows")
          .select("id", { count: "exact", head: true })
          .eq("follower_profile_id", profile.id)
          .eq("followed_type", "competition")
          .eq("followed_id", id)
          .then(({ count }) => (count ?? 0) > 0)
      : Promise.resolve(false),
    getLastSyncedAt(["standing"]),
  ]);

  // A failed read is not a missing competition. readRow throws so the route's
  // error boundary handles it, and only a genuinely absent row reaches
  // notFound() — see src/lib/query-result.ts.
  const competition = readRow(competitionResult, "leagues.detail");
  if (!competition) notFound();

  // Newest first, so the switcher reads the way a fan thinks about seasons.
  const seasons = [...(competition.seasons ?? [])].sort((left, right) => right.name.localeCompare(left.name));
  const currentSeason = seasons.find((s) => s.is_current) ?? seasons[0];

  // `?season=` may only ever name a season belonging to THIS competition.
  // Anything else — another competition's season, a deleted one, a hand-edited
  // id — falls back to the current season rather than rendering one
  // competition's table under another's name and logo.
  const activeSeason = seasons.find((s) => s.id === requestedSeasonId) ?? currentSeason;
  const seasonId = activeSeason?.id ?? null;

  const [
    standingsResult,
    upcomingResult,
    resultsResult,
    snapshotsResult,
    formFixturesResult,
    clubFixturesResult,
    seasonFixtureCount,
    playedFixtureCount,
  ] = seasonId
    ? await Promise.all([
        supabase
          .from("standings")
          .select(
            "team_id, played, won, drawn, lost, goals_for, goals_against, points, position, zone_description, group_label, team:teams(id, name, crest_url)",
          )
          .eq("season_id", seasonId)
          .order("position", { ascending: true }),
        supabase
          .from("fixtures")
          .select(
            `id, kickoff_at, status, home_score, away_score, minute_elapsed,
             home_team:teams!fixtures_home_team_id_fkey(name, crest_url),
             away_team:teams!fixtures_away_team_id_fkey(name, crest_url)`,
          )
          .eq("season_id", seasonId)
          .in("status", ["scheduled", "live", "halftime"])
          .order("kickoff_at", { ascending: true })
          .limit(FIXTURE_LIMIT),
        // Finished only — a postponed or abandoned match has no result to
        // report, and listing one under "Results" with a blank score would
        // invite the reader to supply their own.
        supabase
          .from("fixtures")
          .select(
            `id, kickoff_at, status, home_score, away_score,
             home_team:teams!fixtures_home_team_id_fkey(name, crest_url),
             away_team:teams!fixtures_away_team_id_fkey(name, crest_url)`,
          )
          .eq("season_id", seasonId)
          .eq("status", "finished")
          .not("home_score", "is", null)
          .not("away_score", "is", null)
          .order("kickoff_at", { ascending: false })
          .limit(FIXTURE_LIMIT),
        supabase
          .from("standings_snapshots")
          .select("team_id, position, played")
          .eq("season_id", seasonId)
          .order("captured_at", { ascending: false })
          .limit(SNAPSHOT_LIMIT),
        supabase
          .from("fixtures")
          .select("id, kickoff_at, status, home_score, away_score, home_team_id, away_team_id")
          .eq("season_id", seasonId)
          .eq("status", "finished")
          .order("kickoff_at", { ascending: false })
          .limit(FORM_FIXTURE_LIMIT),
        supabase
          .from("fixtures")
          .select(
            `home_team:teams!fixtures_home_team_id_fkey(id, name, crest_url),
             away_team:teams!fixtures_away_team_id_fkey(id, name, crest_url)`,
          )
          .eq("season_id", seasonId)
          .order("kickoff_at", { ascending: true })
          .limit(CLUB_FIXTURE_LIMIT),
        supabase
          .from("fixtures")
          .select("id", { count: "exact", head: true })
          .eq("season_id", seasonId)
          .then(({ count }) => count ?? 0),
        supabase
          .from("fixtures")
          .select("id", { count: "exact", head: true })
          .eq("season_id", seasonId)
          .eq("status", "finished")
          .then(({ count }) => count ?? 0),
      ])
    : [null, null, null, null, null, null, 0, 0];

  const standingsRows = standingsResult?.data ?? [];
  const upcoming = upcomingResult?.data ?? [];
  const results = resultsResult?.data ?? [];

  // Newest-first snapshots, bucketed per club, so `movementSinceLastPlayed`
  // can walk back to the table as it stood before that club's latest result.
  const snapshotsByTeamId = new Map<string, StandingsSnapshotRow[]>();
  for (const snapshot of snapshotsResult?.data ?? []) {
    const bucket = snapshotsByTeamId.get(snapshot.team_id);
    const entry = { teamId: snapshot.team_id, position: snapshot.position, played: snapshot.played };
    if (bucket) bucket.push(entry);
    else snapshotsByTeamId.set(snapshot.team_id, [entry]);
  }

  // KIVO's own form guide, from finished fixtures it holds. Kept separate from
  // the form string the source publishes alongside the table (`standings.form`,
  // migration 0117): that string states no orientation, and rendering "WWLDW"
  // backwards turns a winning run into a losing one while looking entirely
  // plausible. Fixtures carry kickoff times, so this ordering cannot be wrong.
  const formByTeamId = new Map<string, FormResult[]>();
  const finishedFixtures = formFixturesResult?.data ?? [];
  for (const row of standingsRows) {
    const own = finishedFixtures
      .map((fixture) => resolveFixtureResult(fixture, row.team_id))
      .filter((resolved): resolved is NonNullable<typeof resolved> => resolved !== null);
    if (own.length > 0) formByTeamId.set(row.team_id, computeStandingsForm(own));
  }

  const groups = buildStandingsGroups({
    rows: standingsRows.map((row) => ({
      teamId: row.team_id,
      team: row.team
        ? { id: row.team.id, name: row.team.name, crestUrl: row.team.crest_url }
        : null,
      position: row.position,
      played: row.played,
      won: row.won,
      drawn: row.drawn,
      lost: row.lost,
      goalsFor: row.goals_for,
      goalsAgainst: row.goals_against,
      points: row.points,
      zoneDescription: row.zone_description,
      groupLabel: row.group_label,
    })),
    snapshotsByTeamId,
    formByTeamId,
  });

  // Clubs: the table when there is one (it is the competition's own list), and
  // the season's own fixtures otherwise. Never padded to a league's expected
  // size — a season KIVO holds half a fixture list for shows half a league,
  // which is true, rather than a full one with invented members.
  const clubsById = new Map<string, CompetitionClub>();
  for (const row of standingsRows) {
    if (row.team) {
      clubsById.set(row.team.id, { id: row.team.id, name: row.team.name, crestUrl: row.team.crest_url });
    }
  }
  if (clubsById.size === 0) {
    for (const fixture of clubFixturesResult?.data ?? []) {
      for (const team of [fixture.home_team, fixture.away_team]) {
        if (team && !clubsById.has(team.id)) {
          clubsById.set(team.id, { id: team.id, name: team.name, crestUrl: team.crest_url });
        }
      }
    }
  }
  const clubs = [...clubsById.values()].sort((left, right) => left.name.localeCompare(right.name));

  const hasTable = groups.some((group) => group.rows.length > 0);

  const sections: CompetitionSection[] = [
    {
      id: "table",
      label: "Table",
      content: hasTable ? (
        <StandingsTable
          groups={groups}
          footnote={
            standingsLastSyncedAt ? (
              <div className="flex justify-end px-1">
                <LastSyncedNote timestamp={standingsLastSyncedAt} />
              </div>
            ) : null
          }
        />
      ) : (
        <StandingsEmpty
          seasonLabel={activeSeason?.name ?? null}
          fixtureCount={seasonFixtureCount}
          playedCount={playedFixtureCount}
          action={
            upcoming.length > 0 ? (
              <Link
                href={`/leagues/${competition.id}?${seasonQuery(seasonId, seasons.length)}tab=fixtures`}
                className="kivo-glass-sharp kivo-focus flex h-11 items-center rounded-xl px-4 text-xs font-semibold text-foreground"
              >
                See the fixtures
              </Link>
            ) : null
          }
        />
      ),
    },
  ];

  if (upcoming.length > 0) {
    sections.push({
      id: "fixtures",
      label: "Fixtures",
      count: upcoming.length,
      content: (
        <MatchList>
          {upcoming.map((fixture) => (
            <MatchListRow key={fixture.id} fixture={{ ...fixture, status: fixture.status as FixtureStatus }} />
          ))}
        </MatchList>
      ),
    });
  }

  if (results.length > 0) {
    sections.push({
      id: "results",
      label: "Results",
      count: results.length,
      content: (
        <MatchList>
          {results.map((fixture) => (
            <MatchListRow
              key={fixture.id}
              fixture={{ ...fixture, status: fixture.status as FixtureStatus, minute_elapsed: null }}
            />
          ))}
        </MatchList>
      ),
    });
  }

  // The scoring chart carries its own empty state, and that state distinguishes
  // "nobody has asked for it" from "this source publishes none here" — so
  // unlike the fixture lists it is worth a tab even when it has no rows.
  sections.push({
    id: "scorers",
    label: "Scorers",
    content: (
      <TopScorersPanel seasonId={seasonId} seasonLabel={activeSeason?.name ?? null} />
    ),
  });

  if (clubs.length > 0) {
    sections.push({
      id: "clubs",
      label: "Clubs",
      count: clubs.length,
      content: <CompetitionClubs clubs={clubs} />,
    });
  }

  return (
    <div className="kivo-page">
      <TrackView type="league" id={competition.id} name={competition.name} imageUrl={competition.logo_url} />

      <CompetitionHeader
        competitionId={competition.id}
        name={competition.name}
        logoUrl={competition.logo_url}
        country={competition.country}
        seasonLabel={activeSeason?.name ?? null}
        isFollowing={isFollowing}
        viewerSignedIn={viewerIsSignedIn(profile)}
        seasons={seasons.map((season) => ({ id: season.id, name: season.name, isCurrent: season.is_current }))}
        activeSeasonId={seasonId}
      />

      <CompetitionTabs sections={sections} />

      {/* Below the tabs, not inside one: sharing the table and KIVO's own
          coverage report are both about the page rather than sections of it.
          The coverage panel gates itself to admins and renders nothing for a
          fan — see its own note on why a build report does not belong on a
          competition page. */}
      {seasonId && hasTable && (
        <ShareCardPanel
          kind="league-table"
          id={seasonId}
          // The card has to be the season on screen. Sharing the current
          // season's table from a page showing 2023/24 would be a real table
          // under the wrong year.
          shareUrl={`/leagues/${competition.id}?season=${seasonId}`}
          shareText={`${competition.name} table on KIVO.`}
          heading="Share the table"
          description="Pick a background. The preview is the exact image you save."
        />
      )}
    </div>
  );
}

/** Keeps `?season=` on a link that also sets `?tab=`, but only when the
 * competition genuinely has more than one season to be on. */
function seasonQuery(seasonId: string | null, seasonCount: number): string {
  return seasonId && seasonCount > 1 ? `season=${seasonId}&` : "";
}
