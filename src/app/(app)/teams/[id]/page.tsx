import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeftRight,
  CalendarClock,
  ChartColumn,
  ChevronRight,
  Clock,
  GitCompareArrows,
  Goal,
  History,
  ShieldAlert,
  Table2,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { FadeIn } from "@/components/ui/fade-in";
import { YourTeamConnection } from "@/components/football/your-connection-card";
import { getViewerTeamConnection } from "@/lib/football/viewer-connection";
import { FollowWithMute } from "@/components/ui/follow-with-mute";
import { SaveButton } from "@/components/ui/save-button";
import { LastSyncedNote } from "@/components/football/last-synced-note";
import { AskAiLink } from "@/components/ai/ask-ai-link";
import { TrackView } from "@/components/ui/track-view";
import { TeamAbsencesPanel } from "@/components/football/absences-panel";
import { EntityTabs, type EntityTab } from "@/components/football/entity-tabs";
import { ListSurface, Section, SectionEmpty, StatTile } from "@/components/football/entity-shell";
import { TeamHeader } from "@/components/teams/team-header";
import { NextMatchCard } from "@/components/teams/next-match-card";
import { TeamFixtureRow, type TeamFixture } from "@/components/teams/team-fixture-row";
import { LeagueTable, focusWindow, groupStandings, type StandingRow } from "@/components/teams/league-table";
import { SquadPanel, SquadSummary, type SquadGroup, type SquadPlayer } from "@/components/teams/squad-panel";
import { TeamStatisticsPanel } from "@/components/teams/team-statistics-panel";
import { summarizeTeamStatistics, hasTeamStatistics } from "@/components/teams/team-statistics";
import { TransferLedger, type TransferLedgerEntry } from "@/components/teams/transfer-ledger";
import { PositionHistoryCard, type PositionSnapshot } from "@/components/teams/position-history-card";
import { ClubCommunity } from "@/components/teams/club-community";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { getLastSyncedAt } from "@/lib/football/last-synced";
import { summarizeGoalTiming } from "@/lib/football/goal-timing";
import { computeTeamForm, resolveFixtureResult, type ResolvedResult } from "@/lib/football/form-engine";
import { parseUuidParam } from "@/lib/params";
import { readRow } from "@/lib/query-result";
import { calculateAge, formatNumber } from "@/lib/format";
import { positionGroup, type PositionGroupOrOther } from "@/app/(app)/fantasy/fantasy-rules";
import { viewerIsSignedIn } from "@/lib/guest-preview";

/**
 * A club page, rebuilt around what a fan came for.
 *
 * ## The shape, and where it comes from
 *
 * Identity block, then the one thing you came for, then depth behind tabs.
 * That is the structure every serious football product converged on, and the
 * reason is not fashion: a club has ten legitimate sections and a phone has one
 * screen. The old page stacked all ten down a single column, which meant the
 * next fixture — the single most-wanted fact on any club page — sat below the
 * manager, the injury list and the entire squad.
 *
 * ## A tab has to hold something
 *
 * `tabs` below is assembled from what this club really has. A club with no
 * squad on record is not offered a Squad tab that opens onto an apology; it is
 * offered the tabs it can fill. This is the same rule the Match Centre already
 * applies to its own strip, and it is what lets the page be honest without
 * being apologetic — the two failure modes the founder's verdict was about.
 *
 * ## Nothing on this page is invented
 *
 * Every number is counted from a row KIVO holds. No projected finish, no
 * predicted score, no "form rating" out of ten. Where a fact is missing, the
 * element carrying it is absent — not filled with a dash, and never replaced by
 * a sentence about KIVO's data pipeline, which is what this page used to do in
 * eight places at once.
 */

/**
 * Same 5-way bucketing as fantasy's `positionGroup()` — this page displays
 * "Other" as a real squad section instead of treating it as an invalid pick,
 * so it keeps its own group list while sharing the underlying classifier.
 */
const POSITION_GROUPS = ["Goalkeepers", "Defenders", "Midfielders", "Forwards", "Other"] as const satisfies readonly PositionGroupOrOther[];
type PositionGroup = (typeof POSITION_GROUPS)[number];

/** How many recorded table changes the position chart reaches back over. */
const POSITION_HISTORY_LIMIT = 60;

/** Upcoming and recent lists are capped at a readable length; the Overview's
 * previews are shorter still, because a preview that runs to ten rows is not a
 * preview. */
const FIXTURE_LIMIT = 12;
const OVERVIEW_PREVIEW = 4;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = createServerSupabaseClient();
  const { data: team } = await supabase.from("teams").select("name").eq("id", id).maybeSingle();
  if (!team) return { title: "Team" };

  const description = `Follow ${team.name} on KIVO: live scores, fixtures, squad, and results.`;
  return {
    title: team.name,
    description,
    openGraph: { title: team.name, description },
    twitter: { title: team.name, description },
  };
}

const FIXTURE_SELECT = `id, kickoff_at, status, home_score, away_score, minute_elapsed,
   competition:competitions(name, short_name),
   home_team:teams!fixtures_home_team_id_fkey(id, name, short_name, crest_url),
   away_team:teams!fixtures_away_team_id_fkey(id, name, short_name, crest_url)`;

export default async function TeamProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = parseUuidParam(rawId);
  const supabase = createServerSupabaseClient();
  const profile = await getOrCreateProfile();

  const [
    teamResult,
    { data: standingsRows },
    { data: squad },
    { data: managers },
    { data: upcoming },
    { data: recent },
    { data: followRow },
    isSaved,
    squadLastSyncedAt,
    { data: goalEvents },
    { data: cardEvents },
    { count: finishedMatchesCount },
    { data: transfersLedger },
    transfersLastSyncedAt,
    { data: matchStatistics },
  ] = await Promise.all([
    supabase
      .from("teams")
      .select(
        `id, name, short_name, country, founded_year, crest_url, venue_id,
         venue:venues(name, city, country, capacity)`,
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("standings")
      .select(
        `played, won, drawn, lost, goals_for, goals_against, points, position,
         season:seasons(id, name, is_current, competition:competitions(id, name, short_name))`,
      )
      .eq("team_id", id),
    supabase
      .from("players")
      .select("id, full_name, known_as, position, nationality, photo_url, date_of_birth")
      .eq("current_team_id", id)
      .order("full_name", { ascending: true }),
    supabase
      .from("managers")
      .select("id, full_name, nationality, date_of_birth")
      .eq("current_team_id", id)
      .limit(1),
    supabase
      .from("fixtures")
      .select(FIXTURE_SELECT)
      .or(`home_team_id.eq.${id},away_team_id.eq.${id}`)
      // Live matches belong at the TOP of a club page, not filtered out of both
      // lists: "scheduled" alone meant a club playing right now showed its next
      // match as the one after the one in progress.
      .in("status", ["scheduled", "live", "halftime", "postponed"])
      .order("kickoff_at", { ascending: true })
      .limit(FIXTURE_LIMIT),
    supabase
      .from("fixtures")
      .select(FIXTURE_SELECT)
      .or(`home_team_id.eq.${id},away_team_id.eq.${id}`)
      .eq("status", "finished")
      .order("kickoff_at", { ascending: false })
      .limit(FIXTURE_LIMIT),
    profile
      ? supabase
          .from("follows")
          .select("muted")
          .eq("follower_profile_id", profile.id)
          .eq("followed_type", "team")
          .eq("followed_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    profile
      ? supabase
          .from("saves")
          .select("id", { count: "exact", head: true })
          .eq("profile_id", profile.id)
          .eq("target_type", "team")
          .eq("target_id", id)
          .then(({ count }) => (count ?? 0) > 0)
      : Promise.resolve(false),
    getLastSyncedAt(["player"]),
    // Goal timing: 'goal' and 'penalty_goal' only, scoped to this team's own
    // team_id. Own goals are excluded rather than guessed at — which side's
    // team_id an own goal is recorded under is a provider convention this
    // codebase does not rely on elsewhere.
    supabase
      .from("fixture_events")
      .select("minute")
      .eq("team_id", id)
      .in("event_type", ["goal", "penalty_goal"]),
    supabase
      .from("fixture_events")
      .select("event_type, player:players!fixture_events_player_id_fkey(id, full_name, known_as, photo_url)")
      .eq("team_id", id)
      .in("event_type", ["yellow_card", "second_yellow_card", "red_card"]),
    supabase
      .from("fixtures")
      .select("id", { count: "exact", head: true })
      .or(`home_team_id.eq.${id},away_team_id.eq.${id}`)
      .eq("status", "finished"),
    supabase
      .from("transfers")
      .select(
        `id, transfer_date, fee_text, transfer_type, from_team_id, to_team_id,
         player:players(id, full_name, known_as),
         from_team:teams!transfers_from_team_id_fkey(id, name, short_name, crest_url),
         to_team:teams!transfers_to_team_id_fkey(id, name, short_name, crest_url)`,
      )
      .or(`from_team_id.eq.${id},to_team_id.eq.${id}`)
      .order("transfer_date", { ascending: false }),
    getLastSyncedAt(["transfer"]),
    // Per-match team statistics — possession, shots, passing. Aggregated by
    // `summarizeTeamStatistics`, which counts each metric's own sample.
    supabase
      .from("fixture_statistics")
      .select(
        "possession_pct, shots_total, shots_on_target, passes_total, passes_accurate, corners, fouls, expected_goals",
      )
      .eq("team_id", id),
  ]);

  const team = readRow(teamResult, "teams.detail");
  if (!team) notFound();

  const isFollowing = followRow !== null;
  const isMuted = followRow?.muted ?? false;

  const viewerConnection = profile ? await getViewerTeamConnection(supabase, profile.id, team.id) : null;

  // A club is usually in more than one competition at once. Sorted by matches
  // played descending: the competition a club has played most in this season is
  // its league, which is the position a fan means when they ask where a team
  // is. Nothing is combined — a league record and a cup record are answers to
  // different questions.
  const currentStandings = (standingsRows ?? [])
    .filter((s) => s.season?.is_current)
    .sort((left, right) => right.played - left.played);
  const currentStanding = currentStandings[0] ?? null;
  const otherStandings = currentStandings.slice(1);
  const seasonId = currentStanding?.season?.id ?? null;

  const competitionLabel = currentStanding
    ? (currentStanding.season?.competition?.short_name ?? currentStanding.season?.competition?.name ?? null)
    : null;

  // The rest of the table, and the club's own line on the position chart. Both
  // depend on knowing which season is "the" season, so both wait for it.
  const [{ data: leagueRows }, { data: positionHistoryRows }] = seasonId
    ? await Promise.all([
        supabase
          .from("standings")
          .select(
            `team_id, position, played, won, drawn, lost, goals_for, goals_against, points,
             zone_description, group_label,
             team:teams(id, name, short_name, crest_url)`,
          )
          .eq("season_id", seasonId)
          .order("position", { ascending: true, nullsFirst: false }),
        supabase.rpc("get_team_position_history", {
          p_season_id: seasonId,
          p_team_id: team.id,
          p_limit: POSITION_HISTORY_LIMIT,
        }),
      ])
    : [{ data: null }, { data: null }];

  const table: StandingRow[] = (leagueRows ?? [])
    .filter((row) => row.team !== null)
    .map((row) => ({
      teamId: row.team_id,
      teamName: row.team!.name,
      shortName: row.team!.short_name,
      crestUrl: row.team!.crest_url,
      position: row.position,
      played: row.played,
      won: row.won,
      drawn: row.drawn,
      lost: row.lost,
      goalsFor: row.goals_for,
      goalsAgainst: row.goals_against,
      points: row.points,
      // Migration 0117: the provider's own qualification sentence and group
      // name, both null on most rows and both rendered as nothing when they
      // are. KIVO adds no zone of its own.
      zoneDescription: row.zone_description,
      groupLabel: row.group_label,
    }));

  // A club plays in one group, so the Overview's focused window must be taken
  // from that group's ladder — a window into a 32-row concatenation of eight
  // Champions League groups would show neighbours the club is not playing.
  const ownGroup = table.find((row) => row.teamId === team.id)?.groupLabel ?? null;
  const ownGroupRows = table.filter((row) => row.groupLabel === ownGroup);

  // The RPC returns newest first (a limit on a descending order is the only way
  // to get the latest N); a chart reads left to right in time.
  const positionHistory: PositionSnapshot[] = [...(positionHistoryRows ?? [])]
    .filter((row): row is typeof row & { position: number } => row.position !== null)
    .map((row) => ({
      capturedAt: row.captured_at,
      position: row.position,
      points: row.points,
      played: row.played,
    }))
    .reverse();

  const manager = managers?.[0] ?? null;

  const squadPlayers: SquadPlayer[] = (squad ?? []).map((player) => ({
    id: player.id,
    name: player.known_as ?? player.full_name,
    position: player.position,
    nationality: player.nationality,
    dateOfBirth: player.date_of_birth,
    photoUrl: player.photo_url,
  }));
  const squadByGroup = new Map<PositionGroup, SquadPlayer[]>();
  for (const group of POSITION_GROUPS) squadByGroup.set(group, []);
  for (const player of squad ?? []) {
    squadByGroup.get(positionGroup(player.position))!.push({
      id: player.id,
      name: player.known_as ?? player.full_name,
      position: player.position,
      nationality: player.nationality,
      dateOfBirth: player.date_of_birth,
      photoUrl: player.photo_url,
    });
  }
  const squadGroups: SquadGroup[] = POSITION_GROUPS.map((group) => ({
    title: group,
    players: squadByGroup.get(group) ?? [],
  })).filter((group) => group.players.length > 0);
  const hasSquad = squadPlayers.length > 0;

  const upcomingFixtures = (upcoming ?? []) as TeamFixture[];
  const recentFixtures = (recent ?? []) as TeamFixture[];
  const nextMatch = upcomingFixtures[0] ?? null;

  // Form, from the KIVO Form Engine rather than a fourth hand-rolled W/D/L
  // loop. The same `recent` rows the results list already renders.
  const resolvedResults: ResolvedResult[] = recentFixtures.flatMap((fixture) => {
    if (!fixture.home_team || !fixture.away_team) return [];
    const resolved = resolveFixtureResult(
      {
        id: fixture.id,
        kickoff_at: fixture.kickoff_at,
        status: fixture.status,
        home_score: fixture.home_score,
        away_score: fixture.away_score,
        home_team_id: fixture.home_team.id,
        away_team_id: fixture.away_team.id,
      },
      team.id,
    );
    return resolved ? [resolved] : [];
  });
  const form = computeTeamForm(resolvedResults, "last5");

  const finishedMatches = finishedMatchesCount ?? 0;
  const matchSampleLabel = `From ${finishedMatches} completed match${finishedMatches === 1 ? "" : "es"}.`;

  const { goalsScored, goalsAfter70 } = summarizeGoalTiming((goalEvents ?? []).map((e) => e.minute), finishedMatches);

  type DisciplineRow = { id: string; name: string; photoUrl: string | null; yellow: number; red: number };
  const disciplineByPlayer = new Map<string, DisciplineRow>();
  let teamYellowCards = 0;
  let teamRedCards = 0;
  for (const event of cardEvents ?? []) {
    const isRed = event.event_type === "red_card" || event.event_type === "second_yellow_card";
    if (isRed) teamRedCards += 1;
    else teamYellowCards += 1;
    if (!event.player) continue;
    const row = disciplineByPlayer.get(event.player.id) ?? {
      id: event.player.id,
      name: event.player.known_as ?? event.player.full_name,
      photoUrl: event.player.photo_url,
      yellow: 0,
      red: 0,
    };
    if (isRed) row.red += 1;
    else row.yellow += 1;
    disciplineByPlayer.set(event.player.id, row);
  }
  const disciplineRows = Array.from(disciplineByPlayer.values()).sort((a, b) => b.red - a.red || b.yellow - a.yellow);

  const transferEntries: TransferLedgerEntry[] = (transfersLedger ?? []).map((t) => ({
    id: t.id,
    playerId: t.player?.id ?? null,
    playerName: t.player ? (t.player.known_as ?? t.player.full_name) : null,
    direction: t.to_team_id === team.id ? ("in" as const) : ("out" as const),
    counterpartTeam: t.to_team_id === team.id ? t.from_team : t.to_team,
    transferDate: t.transfer_date,
    feeText: t.fee_text,
    transferType: t.transfer_type,
  }));

  const tableGroups = groupStandings(table);
  const statistics = summarizeTeamStatistics(matchStatistics ?? []);
  const hasStatistics = hasTeamStatistics(statistics);
  const hasDiscipline = teamYellowCards + teamRedCards > 0;
  const hasStatsTab = hasStatistics || goalsScored > 0 || hasDiscipline;

  // A venue row with no name is a venue KIVO cannot name, so the ground line
  // is simply absent rather than linking to a blank.
  const venue =
    team.venue?.name && team.venue_id
      ? { id: team.venue_id, name: team.venue.name, city: team.venue.city, capacity: team.venue.capacity }
      : null;

  // Whether this club has any football on it at all. Drives the one honest
  // sentence on an otherwise empty Overview — and, more importantly, keeps that
  // sentence off a club that DOES have something, where an "early days" note
  // next to a real fixture list would be simply false.
  const hasAnyFootball =
    upcomingFixtures.length > 0 ||
    recentFixtures.length > 0 ||
    hasSquad ||
    currentStanding !== null ||
    transferEntries.length > 0;

  const overviewTab = (
    <>
      {nextMatch ? (
        <Section title="Next match" icon={<CalendarClock className="h-3.5 w-3.5" strokeWidth={2} />}>
          <NextMatchCard fixture={nextMatch} teamId={team.id} venueName={venue?.name ?? null} />
        </Section>
      ) : hasAnyFootball ? (
        <Section title="Next match" icon={<CalendarClock className="h-3.5 w-3.5" strokeWidth={2} />}>
          <SectionEmpty
            icon={<CalendarClock className="h-5 w-5" strokeWidth={1.75} />}
            message={`${team.name} have no scheduled match right now.`}
            action={
              <Link
                href="/matches"
                className="kivo-focus rounded-xl border border-hairline px-3 py-2 text-xs font-semibold text-foreground-muted transition hover:border-hairline-strong hover:text-foreground"
              >
                Today&apos;s matches
              </Link>
            }
          />
        </Section>
      ) : null}

      {recentFixtures.length > 0 && (
        <Section
          title="Recent results"
          icon={<History className="h-3.5 w-3.5" strokeWidth={2} />}
          action={
            form.sampleSize > 0 ? (
              <span className="text-[11px] tabular-nums text-foreground-subtle">
                {form.wins}W {form.draws}D {form.losses}L
              </span>
            ) : undefined
          }
        >
          <ListSurface>
            {recentFixtures.slice(0, OVERVIEW_PREVIEW).map((fixture) => (
              <TeamFixtureRow key={fixture.id} fixture={fixture} teamId={team.id} />
            ))}
          </ListSurface>
        </Section>
      )}

      {/* No "see the full table" affordance on this section on purpose: the
          rail above already offers Table, and a second, non-interactive
          pointer to it is the kind of decorative label that pads a page. */}
      {table.length > 0 && (
        <Section title="In the table" icon={<Table2 className="h-3.5 w-3.5" strokeWidth={2} />}>
          <LeagueTable
            rows={focusWindow(ownGroupRows, team.id)}
            highlightTeamId={team.id}
            caption={[competitionLabel, ownGroup, currentStanding?.season?.name].filter(Boolean).join(" · ") || null}
          />
        </Section>
      )}

      {manager && (
        <Section title="Manager" icon={<UserRound className="h-3.5 w-3.5" strokeWidth={2} />}>
          <Link
            href={`/managers/${manager.id}`}
            className="kivo-glass kivo-glass-interactive kivo-focus flex min-h-[3.5rem] items-center gap-3 rounded-2xl p-4 transition-all hover:-translate-y-0.5"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2">
              <UserRound className="h-5 w-5 text-foreground-subtle" strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">{manager.full_name}</span>
              <span className="block truncate text-[11px] text-foreground-subtle">
                {[manager.nationality, manager.date_of_birth ? `Age ${calculateAge(manager.date_of_birth)}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
          </Link>
        </Section>
      )}

      {hasAnyFootball && <TeamAbsencesPanel teamId={team.id} teamName={team.name} />}

      {!hasAnyFootball && (
        <SectionEmpty
          icon={<Goal className="h-6 w-6" strokeWidth={1.75} />}
          message={`KIVO doesn't cover ${team.name}'s matches yet. Follow the club and it will appear here the moment it does.`}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link
                href="/matches"
                className="kivo-focus flex min-h-11 items-center rounded-xl border border-hairline px-3.5 text-xs font-semibold text-foreground-muted transition hover:border-hairline-strong hover:text-foreground"
              >
                Today&apos;s matches
              </Link>
              <Link
                href="/leagues"
                className="kivo-focus flex min-h-11 items-center rounded-xl border border-hairline px-3.5 text-xs font-semibold text-foreground-muted transition hover:border-hairline-strong hover:text-foreground"
              >
                Browse competitions
              </Link>
            </div>
          }
          className="py-12"
        />
      )}

      <ClubCommunity teamId={team.id} teamName={team.name} viewerProfileId={profile?.id ?? null} />
    </>
  );

  const tabs: EntityTab[] = [{ id: "overview", label: "Overview", content: overviewTab }];

  // Offered only when there is a squad. There is deliberately no staff-only
  // version of this tab any more: it existed to carry a "Sync squad" button,
  // which is an internal control on a page a fan reads. Per-club squad sync
  // lives in Admin instead. The freshness line beside the heading is a real
  // fact for a reader and stays.
  if (hasSquad) {
    tabs.push({
      id: "squad",
      label: "Squad",
      // A count only once it is a real one: "Squad 0" would be a claim about
      // the club rather than about what KIVO holds.
      count: squadPlayers.length,
      content: (
        <>
          <Section
            title="Squad"
            icon={<Users className="h-3.5 w-3.5" strokeWidth={2} />}
            action={<LastSyncedNote timestamp={squadLastSyncedAt} />}
          >
            <SquadSummary players={squadPlayers} />
          </Section>
          <SquadPanel groups={squadGroups} />
        </>
      ),
    });
  }

  if (upcomingFixtures.length > 0) {
    tabs.push({
      id: "fixtures",
      label: "Fixtures",
      count: upcomingFixtures.length,
      content: (
        <Section title="Upcoming" icon={<CalendarClock className="h-3.5 w-3.5" strokeWidth={2} />}>
          <ListSurface>
            {upcomingFixtures.map((fixture) => (
              <TeamFixtureRow key={fixture.id} fixture={fixture} teamId={team.id} />
            ))}
          </ListSurface>
        </Section>
      ),
    });
  }

  if (recentFixtures.length > 0) {
    tabs.push({
      id: "results",
      label: "Results",
      count: recentFixtures.length,
      content: (
        <>
          {form.sampleSize > 0 && (
            <Section title={`Form · ${form.windowLabel}`} icon={<History className="h-3.5 w-3.5" strokeWidth={2} />}>
              <div className="grid grid-cols-4 gap-2">
                <StatTile label="Won" value={String(form.wins)} />
                <StatTile label="Drawn" value={String(form.draws)} />
                <StatTile label="Lost" value={String(form.losses)} />
                <StatTile
                  label="Goals"
                  value={`${form.goalsScored}–${form.goalsConceded}`}
                  hint={form.goalDifference >= 0 ? `+${form.goalDifference}` : String(form.goalDifference)}
                />
              </div>
            </Section>
          )}
          <Section title="Results" icon={<History className="h-3.5 w-3.5" strokeWidth={2} />}>
            <ListSurface>
              {recentFixtures.map((fixture) => (
                <TeamFixtureRow key={fixture.id} fixture={fixture} teamId={team.id} />
              ))}
            </ListSurface>
          </Section>
        </>
      ),
    });
  }

  if (table.length > 0 || otherStandings.length > 0) {
    tabs.push({
      id: "table",
      label: "Table",
      content: (
        <>
          {tableGroups.length > 0 && (
            <Section title="Standings" icon={<Table2 className="h-3.5 w-3.5" strokeWidth={2} />}>
              {tableGroups.map((group) => (
                <LeagueTable
                  key={group.label ?? "single"}
                  rows={group.rows}
                  highlightTeamId={team.id}
                  caption={
                    [competitionLabel, group.label, currentStanding?.season?.name].filter(Boolean).join(" · ") || null
                  }
                  showZoneLegend
                />
              ))}
            </Section>
          )}

          {positionHistory.length >= 2 && currentStanding && (
            <Section title="Position over the season" icon={<Trophy className="h-3.5 w-3.5" strokeWidth={2} />}>
              <PositionHistoryCard
                snapshots={positionHistory}
                teamName={team.name}
                competitionLabel={[competitionLabel, currentStanding.season?.name].filter(Boolean).join(" · ")}
              />
            </Section>
          )}

          {otherStandings.length > 0 && (
            <Section title="Also this season" icon={<Trophy className="h-3.5 w-3.5" strokeWidth={2} />}>
              <ListSurface>
                {otherStandings.map((standing) => (
                  <li
                    key={standing.season?.id ?? standing.season?.name}
                    className="flex min-h-[3rem] items-center justify-between gap-3 px-3 py-2.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground-muted">
                      {standing.season?.competition?.short_name ?? standing.season?.competition?.name ?? "Competition"}
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                      {standing.position !== null ? `${standing.position}${ordinal(standing.position)}` : "–"}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-foreground-subtle">
                      {standing.played} played · {standing.points} pts
                    </span>
                  </li>
                ))}
              </ListSurface>
            </Section>
          )}
        </>
      ),
    });
  }

  if (hasStatsTab) {
    tabs.push({
      id: "stats",
      label: "Stats",
      content: (
        <>
          {hasStatistics && (
            <Section title="How they play" icon={<ChartColumn className="h-3.5 w-3.5" strokeWidth={2} />}>
              <TeamStatisticsPanel summary={statistics} />
            </Section>
          )}

          {goalsScored > 0 && (
            <Section title="Goal timing" icon={<Clock className="h-3.5 w-3.5" strokeWidth={2} />}>
              <div className="kivo-glass flex flex-col gap-2 rounded-2xl p-5">
                <p className="flex items-baseline gap-2">
                  <span className="text-3xl font-semibold tabular-nums text-foreground">{goalsAfter70}</span>
                  <span className="text-sm text-foreground-muted">
                    of {goalsScored} goals scored after the 70th minute
                  </span>
                </p>
                <p className="text-[11px] text-foreground-subtle">{matchSampleLabel}</p>
              </div>
            </Section>
          )}

          {hasDiscipline && (
            <Section title="Discipline" icon={<ShieldAlert className="h-3.5 w-3.5" strokeWidth={2} />}>
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2">
                  <StatTile label="Yellow cards" value={formatNumber(teamYellowCards)} />
                  <StatTile label="Red cards" value={formatNumber(teamRedCards)} />
                </div>
                {disciplineRows.length > 0 && (
                  <ListSurface>
                    {disciplineRows.map((row) => (
                      <li key={row.id}>
                        <Link
                          href={`/players/${row.id}`}
                          className="kivo-focus flex min-h-[3rem] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-2"
                        >
                          <PlayerAvatar photoUrl={row.photoUrl} name={row.name} size={28} />
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">{row.name}</span>
                          <span className="flex shrink-0 items-center gap-2 text-[11px] font-semibold tabular-nums">
                            {row.yellow > 0 && (
                              <span className="rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-warning">
                                {row.yellow}
                              </span>
                            )}
                            {row.red > 0 && (
                              <span className="rounded border border-critical/30 bg-critical/10 px-1.5 py-0.5 text-critical">
                                {row.red}
                              </span>
                            )}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ListSurface>
                )}
                <p className="px-1 text-[11px] text-foreground-subtle">{matchSampleLabel}</p>
              </div>
            </Section>
          )}
        </>
      ),
    });
  }

  if (transferEntries.length > 0) {
    tabs.push({
      id: "transfers",
      label: "Transfers",
      count: transferEntries.length,
      content: (
        <Section
          title="Transfer activity"
          icon={<ArrowLeftRight className="h-3.5 w-3.5" strokeWidth={2} />}
          action={<LastSyncedNote timestamp={transfersLastSyncedAt} />}
        >
          <TransferLedger entries={transferEntries} />
        </Section>
      ),
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 lg:px-8">
      <TrackView type="team" id={team.id} name={team.name} imageUrl={team.crest_url} />

      <TeamHeader
        name={team.name}
        crestUrl={team.crest_url}
        country={team.country}
        foundedYear={team.founded_year}
        venue={venue}
        standing={
          currentStanding
            ? {
                position: currentStanding.position,
                points: currentStanding.points,
                played: currentStanding.played,
                competitionLabel,
              }
            : null
        }
        form={form.sequence}
        actions={
          <>
            <SaveButton targetType="team" targetId={team.id} initialSaved={isSaved} signedIn={viewerIsSignedIn(profile)} />
            <FollowWithMute
              targetType="team"
              targetId={team.id}
              initialFollowing={isFollowing}
              initialMuted={isMuted}
              signedIn={viewerIsSignedIn(profile)}
            />
          </>
        }
        footer={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link
              href={`/teams/compare?a=${team.id}`}
              className="kivo-focus flex items-center gap-1.5 text-xs font-medium text-accent transition hover:text-accent/80"
            >
              <GitCompareArrows className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              Compare
            </Link>
            <AskAiLink ctx="team" id={team.id} label={`Ask AI about ${team.name}`} />
          </div>
        }
      />

      {viewerConnection && (
        <FadeIn delay={0.22}>
          <YourTeamConnection connection={viewerConnection} />
        </FadeIn>
      )}

      <EntityTabs tabs={tabs} ariaLabel={`${team.name} sections`} idPrefix="team" />
    </div>
  );
}

/** "1st", "2nd", "3rd" … Shared with the header's own ordinal, re-declared
 * here only because this file needs it for the secondary competitions list. */
function ordinal(position: number): string {
  const mod100 = position % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (position % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}
