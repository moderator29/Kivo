import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  MapPin,
  Trophy,
  Users,
  UserRound,
  CalendarClock,
  History,
  GitCompareArrows,
  Clock,
  ShieldAlert,
  ArrowLeftRight,
} from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { triggerTeamSquadSync } from "@/app/admin/data-health/actions";
import { FadeIn } from "@/components/ui/fade-in";
import { YourTeamConnection } from "@/components/football/your-connection-card";
import { getViewerTeamConnection } from "@/lib/football/viewer-connection";
import { FollowWithMute } from "@/components/ui/follow-with-mute";
import { SaveButton } from "@/components/ui/save-button";
import { InlineSyncButton } from "@/components/admin/inline-sync-button";
import { LastSyncedNote } from "@/components/football/last-synced-note";
import { AskAiLink } from "@/components/ai/ask-ai-link";
import { TeamCrest } from "@/components/ui/team-crest";
import { competitionName } from "@/lib/football/competition-label";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { TrackView } from "@/components/ui/track-view";
import { FixtureStatusBadge } from "@/components/matches/fixture-status-badge";
import { FormBadges } from "@/components/teams/form-badges";
import { PositionHistoryCard, type PositionSnapshot } from "@/components/teams/position-history-card";
import { getLastSyncedAt } from "@/lib/football/last-synced";
import { summarizeGoalTiming } from "@/lib/football/goal-timing";
import { resultFor, type FormResult } from "@/lib/football/results";
import { TRANSFER_TYPE_LABEL } from "@/lib/football/transfer-labels";
import { parseUuidParam } from "@/lib/params";
import { readRow } from "@/lib/query-result";
import { calculateAge, formatDate, formatNumber } from "@/lib/format";
import { positionGroup, type PositionGroupOrOther } from "@/app/(app)/fantasy/fantasy-rules";
import type { Database } from "@/lib/supabase/types";
import { viewerIsSignedIn } from "@/lib/guest-preview";
import { ClubCommunity } from "@/components/teams/club-community";
import { TeamAbsencesPanel } from "@/components/football/absences-panel";

type FixtureStatus = Database["public"]["Enums"]["fixture_status"];

/**
 * Same 5-way bucketing as fantasy's `positionGroup()` (imported above) — this
 * page just displays "Other" as a real squad section instead of treating it
 * as an invalid pick like fantasy does, so it keeps its own group list while
 * sharing the underlying free-text classifier.
 */
const POSITION_GROUPS = ["Goalkeepers", "Defenders", "Midfielders", "Forwards", "Other"] as const satisfies readonly PositionGroupOrOther[];
type PositionGroup = (typeof POSITION_GROUPS)[number];

type FixtureRow = {
  id: string;
  kickoff_at: string;
  status: FixtureStatus;
  home_score: number | null;
  away_score: number | null;
  competition: { name: string; short_name: string | null } | null;
  home_team: { id: string; name: string; short_name: string | null; crest_url: string | null } | null;
  away_team: { id: string; name: string; short_name: string | null; crest_url: string | null } | null;
};

const RESULT_CLASS: Record<FormResult, string> = {
  W: "text-live",
  L: "text-critical",
  D: "text-foreground-muted",
};

function FixtureListItem({ fixture, teamId }: { fixture: FixtureRow; teamId: string }) {
  const isHome = fixture.home_team?.id === teamId;
  const own = isHome ? fixture.home_team : fixture.away_team;
  const opponent = isHome ? fixture.away_team : fixture.home_team;
  const hasScore = fixture.home_score !== null && fixture.away_score !== null;

  let resultClass = "text-foreground-muted";
  let result: FormResult | null = null;
  // Checking both fields directly here (rather than via the `hasScore` bool
  // above) lets TypeScript narrow them to `number` on its own, instead of
  // asserting it with `!` — same condition either way.
  if (fixture.status === "finished" && fixture.home_score !== null && fixture.away_score !== null) {
    const ownScore = isHome ? fixture.home_score : fixture.away_score;
    const oppScore = isHome ? fixture.away_score : fixture.home_score;
    result = resultFor(ownScore, oppScore);
    resultClass = RESULT_CLASS[result];
  }

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="w-4 shrink-0 text-[11px] font-semibold uppercase text-foreground-subtle">
          {isHome ? "H" : "A"}
        </span>
        <TeamCrest crestUrl={opponent?.crest_url ?? null} name={opponent?.name ?? "Opponent"} />
        <div className="min-w-0">
          {opponent?.id ? (
            <Link
              href={`/teams/${opponent.id}`}
              className="block truncate text-sm text-foreground hover:text-accent"
            >
              {opponent.name}
            </Link>
          ) : (
            <span className="block truncate text-sm text-foreground">{opponent?.name ?? "Unknown opponent"}</span>
          )}
          <span className="text-[11px] text-foreground-subtle">
            {competitionName(fixture.competition, "short")}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <FixtureStatusBadge status={fixture.status} kickoffAt={fixture.kickoff_at} includeWeekday />
        {hasScore && (
          <span className="flex items-center gap-1.5">
            {/* Colour alone (green win, red loss) fails for colour-blind
                users — a real W/D/L letter alongside it, not just an
                aria-label, so it doesn't disappear from a screen reader's
                and a sighted user's experience alike. RECOMMENDATIONS.md
                item 151. */}
            {result && <span className={`text-[11px] font-bold ${resultClass}`}>{result}</span>}
            <span className={`text-sm font-semibold ${resultClass}`}>
              {own?.id === fixture.home_team?.id ? `${fixture.home_score} – ${fixture.away_score}` : `${fixture.away_score} – ${fixture.home_score}`}
            </span>
          </span>
        )}
      </div>
    </li>
  );
}

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

/** How many recorded table changes the position chart reaches back over. A
 * season of snapshots is one row per genuine change, so 60 comfortably covers
 * a whole season for one team while bounding a query that a busy sync could
 * otherwise make unbounded. */
const POSITION_HISTORY_LIMIT = 60;

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
      .select("id, full_name, known_as, position, nationality, photo_url")
      .eq("current_team_id", id)
      .order("full_name", { ascending: true }),
    supabase
      .from("managers")
      .select("id, full_name, nationality, date_of_birth")
      .eq("current_team_id", id)
      .limit(1),
    supabase
      .from("fixtures")
      .select(
        `id, kickoff_at, status, home_score, away_score,
         competition:competitions(name, short_name),
         home_team:teams!fixtures_home_team_id_fkey(id, name, short_name, crest_url),
         away_team:teams!fixtures_away_team_id_fkey(id, name, short_name, crest_url)`,
      )
      .or(`home_team_id.eq.${id},away_team_id.eq.${id}`)
      .eq("status", "scheduled")
      .order("kickoff_at", { ascending: true })
      .limit(10),
    supabase
      .from("fixtures")
      .select(
        `id, kickoff_at, status, home_score, away_score,
         competition:competitions(name, short_name),
         home_team:teams!fixtures_home_team_id_fkey(id, name, short_name, crest_url),
         away_team:teams!fixtures_away_team_id_fkey(id, name, short_name, crest_url)`,
      )
      .or(`home_team_id.eq.${id},away_team_id.eq.${id}`)
      .eq("status", "finished")
      .order("kickoff_at", { ascending: false })
      .limit(10),
    // RECOMMENDATIONS.md item 287: selecting `muted` (not a head-count) so
    // the same row also carries this viewer's per-team mute state for
    // FollowWithMute — a plain existence check would lose it.
    profile
      ? supabase
          .from("follows")
          .select("muted")
          .eq("follower_profile_id", profile.id)
          .eq("followed_type", "team")
          .eq("followed_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // RECOMMENDATIONS.md item 173: team watchlist — real save state,
    // saves_select_own already scopes this to the caller's own row.
    profile
      ? supabase
          .from("saves")
          .select("id", { count: "exact", head: true })
          .eq("profile_id", profile.id)
          .eq("target_type", "team")
          .eq("target_id", id)
          .then(({ count }) => (count ?? 0) > 0)
      : Promise.resolve(false),
    // RECOMMENDATIONS.md item 60: squad sync writes entity_type 'player'
    // (see syncTeamSquad in src/lib/football/sync-squads.ts).
    getLastSyncedAt(["player"]),
    // RECOMMENDATIONS.md item 162: goal-timing distribution. Deliberately
    // 'goal' and 'penalty_goal' only, scoped to this team's own team_id —
    // i.e. goals this team's players actually scored. 'own_goal' rows are
    // left out entirely rather than guessed at: which side's team_id an
    // own goal is recorded under is a provider convention this codebase
    // doesn't rely on elsewhere (fantasy-scoring.ts only ever debits the
    // scoring player, never credits a team), so it's excluded rather than
    // risk crediting the wrong side a goal it didn't score.
    supabase
      .from("fixture_events")
      .select("minute")
      .eq("team_id", id)
      .in("event_type", ["goal", "penalty_goal"]),
    // RECOMMENDATIONS.md item 163: discipline table (cards), team + per-player.
    // `player:players!fixture_events_player_id_fkey` disambiguates from
    // fixture_events' second FK to players (related_player_id), same as
    // Match Centre's own events query does for the same reason.
    supabase
      .from("fixture_events")
      .select("event_type, player:players!fixture_events_player_id_fkey(id, full_name, known_as)")
      .eq("team_id", id)
      .in("event_type", ["yellow_card", "second_yellow_card", "red_card"]),
    // Shared sample-size denominator for items 162 and 163's honesty labels.
    supabase
      .from("fixtures")
      .select("id", { count: "exact", head: true })
      .or(`home_team_id.eq.${id},away_team_id.eq.${id}`)
      .eq("status", "finished"),
    // RECOMMENDATIONS.md item 164: club transfer ledger, both directions.
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
  ]);

  // Same rule as every other detail page: a read that failed throws to the
  // error boundary rather than claiming the club does not exist.
  const team = readRow(teamResult, "teams.detail");
  if (!team) notFound();

  const isFollowing = followRow !== null;
  const isMuted = followRow?.muted ?? false;

  // KN-46: this page rendered identically for somebody who follows this club
  // and somebody who has never heard of it — the only difference anywhere on
  // it was whether a star was filled. Now that every render knows who is
  // reading, it can say what the two of them actually have between them, from
  // the reader's own rows only. Renders nothing at all when there is nothing
  // real to report.
  const viewerConnection = profile ? await getViewerTeamConnection(supabase, profile.id, team.id) : null;

  // A club is usually in more than one competition at once, and each one has
  // its own standings row. The page used to `.find()` a single current row and
  // discard the rest — so a team in a league and a cup group showed one table
  // position and dropped the other, with nothing saying a second existed, and
  // *which* one survived was whatever order the join happened to return.
  //
  // Sorted by matches played, descending: the competition a club has played
  // most in this season is its league, which is the position a fan means when
  // they ask where a team is. The rest follow, each under its own name.
  // Nothing is combined — a league record and a cup record are answers to
  // different questions, and a "total" spanning both would describe no
  // competition that exists.
  const currentStandings = (standingsRows ?? [])
    .filter((s) => s.season?.is_current)
    .sort((left, right) => right.played - left.played);

  const currentStanding = currentStandings[0] ?? null;
  const otherStandings = currentStandings.slice(1);

  // The league-position chart. `standings_snapshots` (migration 0072) has been
  // filling up since the sync started recording it and nothing had ever read
  // it — `get_team_position_history` is the RPC that migration shipped for
  // exactly this. Fetched only when there is a current season to fetch for,
  // and rendered only when two or more snapshots carry a real position, so a
  // team KIVO has watched once shows the standing it already showed and no
  // chart, rather than a line drawn between a point and nothing.
  const seasonId = currentStanding?.season?.id ?? null;
  const { data: positionHistoryRows } = seasonId
    ? await supabase.rpc("get_team_position_history", {
        p_season_id: seasonId,
        p_team_id: team.id,
        p_limit: POSITION_HISTORY_LIMIT,
      })
    : { data: null };
  // The RPC returns newest first (it is a `limit` on a descending order, so
  // that is the only way to get the *latest* N); a chart reads left to right
  // in time.
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

  const squadByGroup = new Map<PositionGroup, NonNullable<typeof squad>>();
  for (const group of POSITION_GROUPS) squadByGroup.set(group, []);
  for (const player of squad ?? []) {
    squadByGroup.get(positionGroup(player.position))!.push(player);
  }
  const hasSquad = (squad?.length ?? 0) > 0;

  const metaParts = [team.country, team.founded_year ? `Founded ${team.founded_year}` : null].filter(Boolean);

  // RECOMMENDATIONS.md item 160: W/D/L strip from the same `recent` fixtures
  // already fetched above for the "Recent results" list (limit 10, newest
  // first) — zero new queries, just the most recent 5 of those 10.
  const recentForm: FormResult[] = (recent ?? [])
    .slice(0, 5)
    .map((fixture): FormResult | null => {
      if (fixture.home_score === null || fixture.away_score === null) return null;
      const isHome = fixture.home_team?.id === team.id;
      const ownScore = isHome ? fixture.home_score : fixture.away_score;
      const oppScore = isHome ? fixture.away_score : fixture.home_score;
      return resultFor(ownScore, oppScore);
    })
    .filter((result): result is FormResult => result !== null);

  const finishedMatches = finishedMatchesCount ?? 0;
  const matchSampleLabel = `From ${finishedMatches} completed match${finishedMatches === 1 ? "" : "es"}.`;

  // RECOMMENDATIONS.md item 162: goal-timing distribution. RECOMMENDATIONS.md
  // item 226: this used to aggregate goalEvents inline, a second copy of the
  // exact aggregation src/lib/football/match-intelligence.ts's
  // fetchTeamGoalTiming already extracted into summarizeGoalTiming() for the
  // AI Copilot's grounding context (see grounding.ts) — same query shape
  // (goal + penalty_goal events, own goals excluded, this team's own
  // team_id), so this now calls that one shared function instead of
  // reimplementing it a second time. isSufficientSample/minSampleRequired
  // are available on the result but deliberately unused here: this page has
  // always shown the real number alongside its real sample-size caption
  // (matchSampleLabel below) rather than gating on a minimum, and changing
  // that display behaviour isn't what item 226 asked for.
  const { goalsScored, goalsAfter70 } = summarizeGoalTiming(
    (goalEvents ?? []).map((e) => e.minute),
    finishedMatches,
  );

  // RECOMMENDATIONS.md item 163: discipline, team totals + per-player.
  type DisciplineRow = { id: string; name: string; yellow: number; red: number };
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
      yellow: 0,
      red: 0,
    };
    if (isRed) row.red += 1;
    else row.yellow += 1;
    disciplineByPlayer.set(event.player.id, row);
  }
  const disciplineRows = Array.from(disciplineByPlayer.values()).sort(
    (a, b) => b.red - a.red || b.yellow - a.yellow,
  );

  // RECOMMENDATIONS.md item 164: club transfer ledger, both directions.
  const transferRows = (transfersLedger ?? []).map((t) => ({
    id: t.id,
    playerId: t.player?.id ?? null,
    playerName: t.player ? (t.player.known_as ?? t.player.full_name) : null,
    direction: t.to_team_id === team.id ? ("in" as const) : ("out" as const),
    counterpartTeam: t.to_team_id === team.id ? t.from_team : t.to_team,
    transferDate: t.transfer_date,
    feeText: t.fee_text,
    transferType: t.transfer_type,
  }));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <TrackView type="team" id={team.id} name={team.name} imageUrl={team.crest_url} />
      <div className="kivo-glass-brand rounded-2xl p-6">
        <div className="flex items-center gap-4">
          <FadeIn delay={0} className="shrink-0">
            <TeamCrest crestUrl={team.crest_url} name={team.name} size={56} />
          </FadeIn>
          <FadeIn delay={0.05} className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold text-foreground">{team.name}</h1>
            {metaParts.length > 0 && <p className="text-xs text-foreground-subtle">{metaParts.join(" · ")}</p>}
          </FadeIn>
          <FadeIn delay={0.1} className="flex items-center gap-2">
            <SaveButton targetType="team" targetId={team.id} initialSaved={isSaved} signedIn={viewerIsSignedIn(profile)} />
            <FollowWithMute
              targetType="team"
              targetId={team.id}
              initialFollowing={isFollowing}
              initialMuted={isMuted}
              signedIn={viewerIsSignedIn(profile)}
            />
          </FadeIn>
        </div>
        <FadeIn delay={0.15}>
          {team.venue && team.venue_id ? (
            <Link
              href={`/venues/${team.venue_id}`}
              className="mt-4 flex items-start gap-2 text-xs text-foreground-muted transition hover:text-accent"
            >
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
              <span>
                {team.venue.name}
                {team.venue.city ? `, ${team.venue.city}` : ""}
                {team.venue.capacity ? ` · Capacity ${formatNumber(team.venue.capacity)}` : ""}
              </span>
            </Link>
          ) : (
            <div className="mt-4 flex items-center gap-2 text-xs text-foreground-subtle">
              <MapPin className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              <span>Home ground not listed</span>
            </div>
          )}
        </FadeIn>
        <FadeIn delay={0.18}>
          <Link
            href={`/teams/compare?a=${team.id}`}
            className="mt-4 flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent/80"
          >
            <GitCompareArrows className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            Compare with another team
          </Link>
        </FadeIn>
        {/* RECOMMENDATIONS.md items 184/185: real, team-scoped AI grounding
            entry point — see ask-ai-link.tsx. */}
        <FadeIn delay={0.2}>
          <AskAiLink ctx="team" id={team.id} label={`Ask AI about ${team.name}`} />
        </FadeIn>
      </div>

      {viewerConnection && (
        <FadeIn delay={0.22}>
          <YourTeamConnection connection={viewerConnection} />
        </FadeIn>
      )}

      <FadeIn delay={0.2} className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <Trophy className="h-4 w-4 text-accent" strokeWidth={1.75} />
          {otherStandings.length > 0 ? "Table positions" : "League position"}
        </h2>
        {currentStanding ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold text-foreground">
                {currentStanding.position !== null ? `#${currentStanding.position}` : "-"}
              </span>
              <span className="text-xs text-foreground-subtle">
                {currentStanding.season?.competition?.short_name ?? currentStanding.season?.competition?.name} ·{" "}
                {currentStanding.season?.name}
              </span>
            </div>
            {positionHistory.length >= 2 && (
              <PositionHistoryCard
                snapshots={positionHistory}
                teamName={team.name}
                competitionLabel={[
                  currentStanding.season?.competition?.short_name ?? currentStanding.season?.competition?.name,
                  currentStanding.season?.name,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            )}
            <div className="grid grid-cols-4 gap-2 text-center sm:grid-cols-7">
              {[
                ["P", currentStanding.played],
                ["W", currentStanding.won],
                ["D", currentStanding.drawn],
                ["L", currentStanding.lost],
                ["GF", currentStanding.goals_for],
                ["GA", currentStanding.goals_against],
                ["PTS", currentStanding.points],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-xl bg-surface-2 px-2 py-2">
                  <div className="text-sm font-semibold text-foreground">{value}</div>
                  <div className="text-[11px] uppercase tracking-wide text-foreground-subtle">{label}</div>
                </div>
              ))}
            </div>

            {/* The competitions the headline position is not about. Each keeps
                its own name and its own figures; nothing is added to anything
                above it. Compact because these are secondary — a cup group
                table is context for the league position, not a rival to it. */}
            {otherStandings.length > 0 && (
              <div className="flex flex-col gap-1.5 border-t border-hairline-soft pt-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                  Also this season
                </span>
                {otherStandings.map((standing) => (
                  <div
                    key={standing.season?.id ?? standing.season?.name}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <span className="min-w-0 flex-1 truncate text-foreground-muted">
                      {standing.season?.competition?.short_name ?? standing.season?.competition?.name ?? "Competition"}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums text-foreground">
                      {standing.position !== null ? `#${standing.position}` : "-"}
                    </span>
                    <span className="shrink-0 tabular-nums text-foreground-subtle">
                      {standing.played} played · {standing.points} pts
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-foreground-muted">No league table for this club yet.</p>
        )}
      </FadeIn>

      <FadeIn delay={0.25} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <UserRound className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Manager
        </h2>
        {manager ? (
          <Link
            href={`/managers/${manager.id}`}
            className="kivo-glass kivo-glass-interactive flex items-center gap-3 rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:bg-surface-2"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2">
              <UserRound className="h-5 w-5 text-foreground-subtle" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-sm text-foreground">{manager.full_name}</p>
              <p className="text-[11px] text-foreground-subtle">
                {[manager.nationality, manager.date_of_birth ? `Age ${calculateAge(manager.date_of_birth)}` : null]
                  .filter(Boolean)
                  .join(" · ") || "-"}
              </p>
            </div>
          </Link>
        ) : (
          <div className="kivo-glass rounded-2xl p-5 text-center text-sm text-foreground-muted">
            Manager not listed.
          </div>
        )}
      </FadeIn>

      {/* Directly above the squad, because "who is available" is the question
          a reader is already asking by the time they reach the squad list. */}
      <TeamAbsencesPanel teamId={team.id} teamName={team.name} />

      <FadeIn delay={0.3} className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
            <Users className="h-4 w-4 text-accent" strokeWidth={1.75} />
            Squad
          </h2>
          <LastSyncedNote timestamp={squadLastSyncedAt} />
        </div>
        {hasSquad ? (
          <div className="flex flex-col gap-4">
            {POSITION_GROUPS.map((group) => {
              const players = squadByGroup.get(group) ?? [];
              if (players.length === 0) return null;
              return (
                <div key={group} className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
                    {group}
                  </span>
                  <div className="kivo-glass flex flex-col divide-y divide-hairline-soft rounded-2xl">
                    {players.map((player) => (
                      <Link
                        key={player.id}
                        href={`/players/${player.id}`}
                        className="flex items-center gap-3 px-4 py-3 transition-all hover:translate-x-1 hover:bg-surface-2"
                      >
                        <PlayerAvatar photoUrl={player.photo_url} name={player.known_as ?? player.full_name} size={36} />
                        <div className="min-w-0">
                          <p className="truncate text-sm text-foreground">{player.known_as ?? player.full_name}</p>
                          <p className="truncate text-[11px] text-foreground-subtle">
                            {[player.position, player.nationality].filter(Boolean).join(" · ") || "-"}
                          </p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-5 text-center text-sm text-foreground-muted">
            The squad list for this club isn&apos;t available yet.
            {canManageFootballData(profile?.role) && (
              <InlineSyncButton
                label="Sync squad"
                action={triggerTeamSquadSync.bind(null, team.id)}
                hint="Needs this club's fixtures first, so it has a mapping to pull a squad against."
              />
            )}
          </div>
        )}
      </FadeIn>

      <FadeIn delay={0.35} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <CalendarClock className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Upcoming fixtures
        </h2>
        {upcoming && upcoming.length > 0 ? (
          // FRONTEND SWEEP: one surface, hairline-divided rows — not one card
          // per fixture. Same rule MatchList applies to /matches; the row here
          // stays team-relative because that IS the information this list
          // carries, and only the container changes.
          <div className="kivo-glass overflow-hidden rounded-2xl">
            <ul className="flex flex-col divide-y divide-hairline-soft">
              {upcoming.map((fixture) => (
                <FixtureListItem key={fixture.id} fixture={fixture} teamId={team.id} />
              ))}
            </ul>
          </div>
        ) : (
          <div className="kivo-glass rounded-2xl p-5 text-center text-sm text-foreground-muted">
            No upcoming fixtures scheduled yet.
          </div>
        )}
      </FadeIn>

      <FadeIn delay={0.4} className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
            <History className="h-4 w-4 text-accent" strokeWidth={1.75} />
            Recent results
          </h2>
          {/* RECOMMENDATIONS.md item 160: at-a-glance form strip, derived
              from these same fixtures rather than a new query. */}
          {recentForm.length > 0 && <FormBadges form={recentForm} />}
        </div>
        {recent && recent.length > 0 ? (
          // FRONTEND SWEEP: one surface, hairline-divided rows — not one card
          // per fixture. Same rule MatchList applies to /matches; the row here
          // stays team-relative because that IS the information this list
          // carries, and only the container changes.
          <div className="kivo-glass overflow-hidden rounded-2xl">
            <ul className="flex flex-col divide-y divide-hairline-soft">
              {recent.map((fixture) => (
                <FixtureListItem key={fixture.id} fixture={fixture} teamId={team.id} />
              ))}
            </ul>
          </div>
        ) : (
          <div className="kivo-glass rounded-2xl p-5 text-center text-sm text-foreground-muted">
            No results yet.
          </div>
        )}
      </FadeIn>

      <FadeIn delay={0.45} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <Clock className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Goal timing
        </h2>
        {goalsScored > 0 ? (
          <div className="kivo-glass flex flex-col gap-2 rounded-2xl p-5">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold text-foreground">{goalsAfter70}</span>
              <span className="text-sm text-foreground-muted">of {goalsScored} goals scored after the 70th minute</span>
            </div>
            <p className="text-xs text-foreground-subtle">{matchSampleLabel}</p>
          </div>
        ) : (
          <div className="kivo-glass rounded-2xl p-5 text-center text-sm text-foreground-muted">
            {finishedMatches > 0
              ? `No goals recorded yet for this team. ${matchSampleLabel}`
              : "No completed matches for this club yet."}
          </div>
        )}
      </FadeIn>

      <FadeIn delay={0.48} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <ShieldAlert className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Discipline
        </h2>
        {teamYellowCards + teamRedCards > 0 ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="kivo-glass rounded-xl px-2 py-3">
                <div className="text-lg font-semibold text-foreground">{teamYellowCards}</div>
                <div className="text-[11px] uppercase tracking-wide text-foreground-subtle">Yellow cards</div>
              </div>
              <div className="kivo-glass rounded-xl px-2 py-3">
                <div className="text-lg font-semibold text-foreground">{teamRedCards}</div>
                <div className="text-[11px] uppercase tracking-wide text-foreground-subtle">Red cards</div>
              </div>
            </div>
            {disciplineRows.length > 0 && (
              <div className="kivo-glass flex flex-col divide-y divide-hairline-soft rounded-2xl">
                {disciplineRows.map((row) => (
                  <Link
                    key={row.id}
                    href={`/players/${row.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition-all hover:translate-x-1 hover:bg-surface-2"
                  >
                    <span className="truncate text-sm text-foreground">{row.name}</span>
                    <span className="flex shrink-0 items-center gap-3 text-xs font-semibold tabular-nums text-foreground-subtle">
                      {row.yellow > 0 && <span>{row.yellow} yellow</span>}
                      {row.red > 0 && <span>{row.red} red</span>}
                    </span>
                  </Link>
                ))}
              </div>
            )}
            <p className="text-xs text-foreground-subtle">{matchSampleLabel}</p>
          </div>
        ) : (
          <div className="kivo-glass rounded-2xl p-5 text-center text-sm text-foreground-muted">
            {finishedMatches > 0
              ? `No cards recorded yet for this team. ${matchSampleLabel}`
              : "No completed matches for this club yet."}
          </div>
        )}
      </FadeIn>

      <FadeIn delay={0.5} className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
            <ArrowLeftRight className="h-4 w-4 text-accent" strokeWidth={1.75} />
            Transfer activity
          </h2>
          <LastSyncedNote timestamp={transfersLastSyncedAt} />
        </div>
        {transferRows.length > 0 ? (
          <div className="flex flex-col gap-2">
            {transferRows.map((transfer) => (
              <div
                key={transfer.id}
                className="kivo-glass flex flex-col gap-3 rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:bg-surface-2"
              >
                <div className="flex items-center justify-between gap-3">
                  {transfer.playerId && transfer.playerName ? (
                    <Link
                      href={`/players/${transfer.playerId}`}
                      className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground transition hover:text-accent"
                    >
                      <UserRound className="h-4 w-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
                      <span className="truncate">{transfer.playerName}</span>
                    </Link>
                  ) : (
                    <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground-subtle">
                      <UserRound className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                      Unknown player
                    </span>
                  )}
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                      transfer.direction === "in"
                        ? "border-live/30 bg-live/10 text-live"
                        : "border-critical/30 bg-critical/10 text-critical"
                    }`}
                  >
                    {transfer.direction === "in" ? "In" : "Out"}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-foreground-muted">
                  {transfer.direction === "in" ? "From" : "To"}
                  {transfer.counterpartTeam ? (
                    <Link
                      href={`/teams/${transfer.counterpartTeam.id}`}
                      className="flex min-w-0 items-center gap-2 text-foreground transition hover:text-accent"
                    >
                      <TeamCrest crestUrl={transfer.counterpartTeam.crest_url} name={transfer.counterpartTeam.name} size={22} />
                      <span className="truncate">{transfer.counterpartTeam.short_name ?? transfer.counterpartTeam.name}</span>
                    </Link>
                  ) : (
                    <span className="text-foreground-subtle">Unknown club</span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-hairline-soft pt-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-hairline px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
                      {TRANSFER_TYPE_LABEL[transfer.transferType]}
                    </span>
                    <span className="text-[11px] text-foreground-subtle">{formatDate(transfer.transferDate, { month: "short" })}</span>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-foreground">{transfer.feeText ?? "-"}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="kivo-glass rounded-2xl p-5 text-center text-sm text-foreground-muted">
            No transfer activity recorded for this club yet.
          </div>
        )}
      </FadeIn>

      {/* KIVO_NEXT_GEN KN-102. Derived, not declared: this club's conversation
          is already sitting in the Match Rooms of its own fixtures, reachable
          through posts.fixture_id with no new column and no compose-time tag.
          Renders nothing at all when there is nothing to show — a club page
          should not carry an empty "community" heading. */}
      <ClubCommunity teamId={team.id} teamName={team.name} viewerProfileId={profile?.id ?? null} />
    </div>
  );
}
