import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, ArrowLeftRight, GitCompareArrows, Trophy } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readOptionalRow, readRow } from "@/lib/query-result";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { FadeIn } from "@/components/ui/fade-in";
import { YourPlayerConnection } from "@/components/football/your-connection-card";
import { getViewerPlayerConnection } from "@/lib/football/viewer-connection";
import { FollowWithMute } from "@/components/ui/follow-with-mute";
import { SaveButton } from "@/components/ui/save-button";
import { LastSyncedNote } from "@/components/football/last-synced-note";
import { AskAiLink } from "@/components/ai/ask-ai-link";
import { TeamCrest } from "@/components/ui/team-crest";
import { TrackView } from "@/components/ui/track-view";
import { FormBadges } from "@/components/teams/form-badges";
import { EntityTabs, type EntityTab } from "@/components/football/entity-tabs";
import { Section } from "@/components/ui/section";
import { ListSurface } from "@/components/ui/list-surface";
import { StatBlock, StatGrid } from "@/components/ui/stat-block";
import { EmptyState } from "@/components/ui/empty-state";
import { PlayerHeader } from "@/components/players/player-header";
import { PlayerMatchLog, type MatchLogRow } from "@/components/players/player-match-log";
import { CareerChart } from "@/components/players/career-chart";
import {
  buildPlayerMatchLog,
  hasCareerProgression,
  summarizeCareerBySeason,
  type PlayerFixtureInput,
} from "@/components/players/player-career";
import { getLastSyncedAt } from "@/lib/football/last-synced";
import { ShareCardPanel } from "@/components/share/share-card-panel";
import { TRANSFER_TYPE_LABEL } from "@/lib/football/transfer-labels";
import { computePlayerMatchStats } from "@/lib/football/player-stats";
import { computePlayerForm, type ResolvedResult } from "@/lib/football/form-engine";
import { aggregateSeasonRating, RATING_MODEL_VERSION } from "@/lib/football/rating-engine";
import { competitionName } from "@/lib/football/competition-label";
import { formatDate, formatNumber } from "@/lib/format";
import { ensureFantasyPlayerPrices, getFantasyPriceMap } from "@/lib/fantasy";
import { viewerIsSignedIn } from "@/lib/guest-preview";
import { DEFAULT_FANTASY_PRICE, formatFantasyPrice } from "@/app/(app)/fantasy/fantasy-rules";
import { PlayerAbsenceNote } from "@/components/football/absences-panel";
import { PlayerSeasonStatisticsPanel } from "@/components/football/season-statistics-panel";

/**
 * A player page, rebuilt around the question a fan opens one with: what has
 * this player actually done?
 *
 * ## Shape
 *
 * Identity block with the four numbers that define a player's season, then
 * depth behind tabs — the same structure as the club page and the Match
 * Centre, using the same rail (`SectionTabs`, see `docs/UI_PRIMITIVES.md`).
 *
 * ## The new thing on this page
 *
 * A match log. KIVO could previously tell you a career total and a form strip
 * and nothing in between: there was no way to see the matches the totals came
 * from. `buildPlayerMatchLog` assembles one from rows KIVO already holds — the
 * player's `lineups`, the `fixture_events` they are the subject or the assist
 * of, and their real minutes where the provider reported them — and rates each
 * one through the shared KIVO Rating Engine.
 *
 * ## Nothing here is invented
 *
 * A rating is `null` for a match the engine has no evidence the player played
 * in, and a null rating renders as no chip rather than a neutral 6.0. Minutes
 * are never assumed from "started". A season with no goals figure reported
 * shows a dash, and the dash is explained once rather than per row. The four
 * headline numbers exist only once the player has played a match KIVO holds.
 */

// Same minimum-sample suppression convention as this page's other real-but-thin
// aggregates: a gameweek with only a handful of total fantasy picks league-wide
// should not render a precise-looking ownership percentage.
const MIN_FANTASY_OWNERSHIP_SAMPLE = 10;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = createServerSupabaseClient();
  // readOptionalRow, not readRow: a page title is never worth taking the page
  // down for.
  const player = readOptionalRow(
    await supabase.from("players").select("known_as, full_name").eq("id", id).maybeSingle(),
    "players.detail.metadata",
  );
  const name = (player?.known_as ?? player?.full_name) || null;
  if (!name) return { title: "Player" };

  const description = `${name}'s profile on KIVO: stats, current club, and transfer history.`;
  return {
    title: name,
    description,
    openGraph: { title: name, description },
    twitter: { title: name, description },
  };
}

export default async function PlayerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerSupabaseClient();
  const profile = await getOrCreateProfile();

  const [
    playerResult,
    { data: lineupRows },
    { data: eventRows },
    { data: relatedEventRows },
    { data: matchStatRows },
    { data: transfers },
    { data: followRow },
    isSaved,
    transfersLastSyncedAt,
    { data: seasonStatRows },
  ] = await Promise.all([
    supabase
      .from("players")
      .select(
        `id, full_name, known_as, date_of_birth, nationality, position, photo_url, current_team_id,
         current_team:teams(id, name, short_name, crest_url)`,
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("lineups")
      .select(
        `id, is_starting, team_id,
         fixture:fixtures(
           id, status, kickoff_at, home_team_id, away_team_id, home_score, away_score,
           competition:competitions(name, short_name),
           home_team:teams!fixtures_home_team_id_fkey(id, name, short_name, crest_url),
           away_team:teams!fixtures_away_team_id_fkey(id, name, short_name, crest_url)
         )`,
      )
      .eq("player_id", id),
    // The player as the SUBJECT of an event: their goals, their cards.
    // `fixture_id` comes along so the match log can attribute each one to the
    // match it happened in rather than only to a career total.
    supabase.from("fixture_events").select("fixture_id, event_type").eq("player_id", id),
    // The player in the RELATED slot. API-Football puts the assister on the
    // goal event itself, and the incoming player on a substitution event —
    // both of which sync-match-details.ts maps to `related_player_id`, so one
    // query carries assists and "came on" together.
    supabase.from("fixture_events").select("fixture_id, event_type").eq("related_player_id", id),
    supabase.from("fixture_player_statistics").select("fixture_id, minutes_played").eq("player_id", id),
    supabase
      .from("transfers")
      .select(
        `id, transfer_date, fee_text, transfer_type,
         from_team:teams!transfers_from_team_id_fkey(id, name, short_name, crest_url),
         to_team:teams!transfers_to_team_id_fkey(id, name, short_name, crest_url)`,
      )
      .eq("player_id", id)
      .order("transfer_date", { ascending: false }),
    profile
      ? supabase
          .from("follows")
          .select("muted")
          .eq("follower_profile_id", profile.id)
          .eq("followed_type", "player")
          .eq("followed_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    profile
      ? supabase
          .from("saves")
          .select("id", { count: "exact", head: true })
          .eq("profile_id", profile.id)
          .eq("target_type", "player")
          .eq("target_id", id)
          .then(({ count }) => (count ?? 0) > 0)
      : Promise.resolve(false),
    getLastSyncedAt(["transfer"]),
    supabase
      .from("player_season_statistics")
      .select("season_year, appearances, minutes_played, goals, assists")
      .eq("player_id", id),
  ]);

  // A failed read is a fact about the request, not a claim about the world:
  // readRow throws so the error boundary handles it as what it is, and returns
  // null only for a player who genuinely is not there.
  const player = readRow(playerResult, "players.detail");
  if (!player) notFound();

  const displayName = player.known_as ?? player.full_name;
  const isAdmin = canManageFootballData(profile?.role);

  // Real fantasy price + ownership, only once a current season is resolvable
  // for this player's current club — a player has no season row of their own.
  let fantasySeasonId: string | null = null;
  if (player.current_team_id) {
    const { data: standingsRows } = await supabase
      .from("standings")
      .select("season:seasons(id, is_current)")
      .eq("team_id", player.current_team_id);
    fantasySeasonId = (standingsRows ?? []).find((s) => s.season?.is_current)?.season?.id ?? null;
  }

  let fantasyPrice: number | null = null;
  let fantasyOwnership: { playerCount: number; totalCount: number } | null = null;
  if (fantasySeasonId) {
    await ensureFantasyPlayerPrices(fantasySeasonId, [player.id]);
    const [priceMap, { data: ownershipRows }] = await Promise.all([
      getFantasyPriceMap(fantasySeasonId, [player.id]),
      supabase.rpc("get_fantasy_ownership", { p_player_id: player.id, p_season_id: fantasySeasonId }),
    ]);
    fantasyPrice = priceMap.get(player.id) ?? DEFAULT_FANTASY_PRICE;
    const ownershipRow = ownershipRows?.[0];
    if (ownershipRow) {
      fantasyOwnership = { playerCount: ownershipRow.player_count, totalCount: ownershipRow.total_count };
    }
  }
  const hasMeaningfulOwnership = fantasyOwnership !== null && fantasyOwnership.totalCount >= MIN_FANTASY_OWNERSHIP_SAMPLE;
  const ownershipPct =
    hasMeaningfulOwnership && fantasyOwnership
      ? Math.round((fantasyOwnership.playerCount / fantasyOwnership.totalCount) * 100)
      : null;

  const isFollowing = followRow !== null;
  const isMuted = followRow?.muted ?? false;

  const viewerConnection = profile ? await getViewerPlayerConnection(supabase, profile.id, player.id) : null;

  // Career totals stay on the shared `computePlayerMatchStats`, unchanged: the
  // match log below is a different view of the same rows, not a second
  // accountant, and two functions counting one career would eventually
  // disagree.
  const stats = computePlayerMatchStats(
    lineupRows ?? [],
    (eventRows ?? []).map((row) => ({ event_type: row.event_type })),
    (relatedEventRows ?? []).map((row) => ({ event_type: row.event_type })),
  );
  const hasMatchData = stats.appearances > 0;

  // --- The match log, and everything derived from it -----------------------

  const fixtureById = new Map<string, NonNullable<NonNullable<typeof lineupRows>[number]["fixture"]>>();
  const playerFixtures: PlayerFixtureInput[] = [];
  for (const row of lineupRows ?? []) {
    if (!row.fixture) continue;
    fixtureById.set(row.fixture.id, row.fixture);
    playerFixtures.push({
      fixtureId: row.fixture.id,
      kickoffAt: row.fixture.kickoff_at,
      status: row.fixture.status,
      teamId: row.team_id,
      isStarting: row.is_starting,
      homeTeamId: row.fixture.home_team_id,
      awayTeamId: row.fixture.away_team_id,
      homeScore: row.fixture.home_score,
      awayScore: row.fixture.away_score,
    });
  }

  const minutesByFixture = new Map<string, number | null>(
    (matchStatRows ?? []).map((row) => [row.fixture_id, row.minutes_played]),
  );

  const matchLog = buildPlayerMatchLog({
    playerId: player.id,
    position: player.position,
    fixtures: playerFixtures,
    subjectEvents: (eventRows ?? []).map((row) => ({ fixtureId: row.fixture_id, eventType: row.event_type })),
    relatedEvents: (relatedEventRows ?? []).map((row) => ({ fixtureId: row.fixture_id, eventType: row.event_type })),
    minutesByFixture,
  });

  const matchLogRows: MatchLogRow[] = matchLog.map((entry) => {
    const fixture = fixtureById.get(entry.fixtureId);
    const opponent = entry.isHome ? fixture?.away_team : fixture?.home_team;
    return {
      ...entry,
      opponentName: opponent?.name ?? "Opponent",
      opponentShortName: opponent?.short_name ?? null,
      opponentCrestUrl: opponent?.crest_url ?? null,
      competitionLabel: competitionName(fixture?.competition ?? null, "short"),
    };
  });

  // Form, from the same log. A player has no individual W/D/L in football —
  // they share their team's real result, resolved against the team they were
  // named for on the day (`lineups.team_id`).
  const resolvedResults: ResolvedResult[] = matchLog.flatMap((entry) =>
    entry.ownScore !== null && entry.oppScore !== null
      ? [{ fixtureId: entry.fixtureId, kickoffAt: entry.kickoffAt, ownScore: entry.ownScore, oppScore: entry.oppScore }]
      : [],
  );
  const recentForm = computePlayerForm(resolvedResults, "last5");

  // KIVO's own average match rating. `aggregateSeasonRating` returns null for
  // zero rated matches and flags a thin sample rather than hiding it, so the
  // number can be shown with an honest caveat instead of disappearing.
  const ratingSummary = aggregateSeasonRating(
    matchLog.flatMap((entry) => (entry.rating ? [entry.rating] : [])),
  );

  const careerSeasons = summarizeCareerBySeason(seasonStatRows ?? []);
  const showCareerChart = hasCareerProgression(careerSeasons);

  // The four numbers in the header. Assists are omitted entirely rather than
  // shown as zero when KIVO has not counted them — `stats.assists` is null for
  // a caller that never queried them, and null is not zero.
  const headline: { label: string; value: string; hint?: string; tone?: "default" | "accent" }[] = hasMatchData
    ? [
        { label: "Apps", value: String(stats.appearances) },
        { label: "Goals", value: String(stats.goals) },
        ...(stats.assists !== null ? [{ label: "Assists", value: String(stats.assists) }] : []),
        ...(ratingSummary
          ? [
              {
                label: "Rating",
                value: ratingSummary.average.toFixed(2),
                hint: ratingSummary.isSufficientSample ? undefined : `${ratingSummary.sampleSize} rated`,
                tone: "accent" as const,
              },
            ]
          : []),
      ]
    : [];

  // --- Tabs ----------------------------------------------------------------

  const overviewTab = (
    <>
      {/* Above everything else, because whether a player is currently available
          changes how every number below should be read. Renders nothing at all
          when there is no report — an "available" badge would be a fitness
          claim KIVO cannot make. */}
      <PlayerAbsenceNote playerId={player.id} />

      {viewerConnection && <YourPlayerConnection connection={viewerConnection} />}

      {hasMatchData ? (
        <>
          {ratingSummary && (
            <Section title="KIVO rating">
              <div className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
                <div className="flex items-baseline gap-3">
                  <span className="text-4xl font-semibold tabular-nums leading-none text-accent">
                    {ratingSummary.average.toFixed(2)}
                  </span>
                  <span className="text-xs text-foreground-muted">
                    across {ratingSummary.sampleSize} rated{" "}
                    {ratingSummary.sampleSize === 1 ? "match" : "matches"}
                  </span>
                </div>
                <p className="border-t border-hairline-soft pt-3 text-xs leading-relaxed text-foreground-subtle">
                  KIVO&apos;s own model (v{RATING_MODEL_VERSION}), computed from real goals, assists, cards and the
                  match result — not a rating published by anyone else.
                  {!ratingSummary.isSufficientSample &&
                    ` Only ${ratingSummary.sampleSize} rated ${ratingSummary.sampleSize === 1 ? "match" : "matches"} so far, so read it lightly.`}
                </p>
              </div>
            </Section>
          )}

          {recentForm.isSufficientSample && (
            <Section title="Recent form">
              <div className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
                <FormBadges form={recentForm.sequence} />
                <p className="text-xs leading-relaxed text-foreground-subtle">
                  {displayName}&apos;s team in the {recentForm.sampleSize} most recent finished{" "}
                  {recentForm.sampleSize === 1 ? "match" : "matches"} they were named for: {recentForm.wins}W{" "}
                  {recentForm.draws}D {recentForm.losses}L · {recentForm.goalsScored} scored, {recentForm.goalsConceded}{" "}
                  conceded.
                </p>
              </div>
            </Section>
          )}

          {matchLogRows.length > 0 && (
            <Section title="Last matches">
              <ListSurface>
                <MatchLogPreview rows={matchLogRows.slice(0, 3)} />
              </ListSurface>
            </Section>
          )}
        </>
      ) : (
        <EmptyState
          tone="page"
          icon={Activity}
          title="No matches yet"
          description={
            player.current_team
              ? `${displayName} hasn't played in a match KIVO covers. Appearances for ${player.current_team.name} will show up here.`
              : `${displayName} hasn't played in a match KIVO covers.`
          }
          action={
            player.current_team ? (
              <Link
                href={`/teams/${player.current_team.id}`}
                className="kivo-focus flex min-h-11 items-center gap-2 rounded-xl border border-hairline px-3.5 text-sm font-semibold text-foreground-muted transition-colors duration-150 hover:border-hairline-strong hover:text-foreground motion-reduce:transition-none"
              >
                <TeamCrest crestUrl={player.current_team.crest_url} name={player.current_team.name} size={16} />
                {player.current_team.name}
              </Link>
            ) : undefined
          }
        />
      )}

      {fantasySeasonId && fantasyPrice !== null && (
        <Section title="Fantasy">
          <div className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-2xl font-semibold tabular-nums text-foreground">{formatFantasyPrice(fantasyPrice)}</p>
                <p className="text-[11px] text-foreground-subtle">Current KIVO fantasy price</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-semibold tabular-nums text-foreground">
                  {ownershipPct !== null ? `${ownershipPct}%` : "–"}
                </p>
                <p className="text-[11px] text-foreground-subtle">
                  {ownershipPct !== null ? "Rostered this gameweek" : "Not enough squads yet"}
                </p>
              </div>
            </div>
            <p className="border-t border-hairline-soft pt-3 text-xs leading-relaxed text-foreground-subtle">
              KIVO&apos;s own internal fantasy-game currency — not a real transfer-market value — moves in small, capped
              steps based on this player&apos;s real recent match performance relative to their position group.
            </p>
            <Link
              href="/fantasy"
              className="kivo-focus flex items-center gap-1.5 text-xs font-medium text-kivo-cyan hover:text-kivo-cyan/80"
            >
              <Trophy className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              Build your fantasy squad
            </Link>
          </div>
        </Section>
      )}

      {/* Renders nothing at all if KIVO has no synced numbers for this player. */}
      <div className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
        <ShareCardPanel
          kind="player-performance"
          id={player.id}
          shareUrl={`/players/${player.id}`}
          shareText={`${displayName} on KIVO.`}
          heading="Share this player"
          description="Pick a background. The preview is the exact image you save."
        />
      </div>
    </>
  );

  const tabs: EntityTab[] = [{ id: "overview", label: "Overview", content: overviewTab }];

  if (matchLogRows.length > 0) {
    tabs.push({
      id: "matches",
      label: "Matches",
      count: matchLogRows.length,
      content: (
        <Section title="Match by match">
          <PlayerMatchLog rows={matchLogRows} />
        </Section>
      ),
    });
  }

  // Offered whenever there is a by-competition breakdown to show, a career to
  // chart, or a career total counted from KIVO's own fixtures.
  //
  // `isAdmin` is in this condition and nowhere else on the page: it does not
  // add a control, it only keeps `PlayerSeasonStatisticsPanel` reachable for
  // staff on a player it holds nothing for. That panel owns its own staff
  // affordance and lives outside this page; gating the tab is the least this
  // page can do without reaching into it.
  const hasSeasonStatistics = (seasonStatRows ?? []).length > 0;
  if (hasSeasonStatistics || hasMatchData || isAdmin) {
    tabs.push({
      id: "stats",
      label: "Stats",
      content: (
        <>
          {showCareerChart && (
            <Section title="Season by season">
              <CareerChart seasons={careerSeasons} />
            </Section>
          )}

          {hasMatchData && (
            <Section title="Career on KIVO">
              <div className="flex flex-col gap-3">
                <StatGrid columns={3}>
                  <StatBlock label="Apps" value={formatNumber(stats.appearances)} />
                  <StatBlock label="Starts" value={formatNumber(stats.starts)} />
                  <StatBlock label="Goals" value={formatNumber(stats.goals)} />
                  {stats.assists !== null && <StatBlock label="Assists" value={formatNumber(stats.assists)} />}
                  <StatBlock label="Yellow" value={formatNumber(stats.yellowCards)} />
                  <StatBlock label="Red" value={formatNumber(stats.redCards)} />
                </StatGrid>
                {/* These were once headed "Season stats", which was false twice
                    over: not one season, and not one competition. Naming the
                    scope is the whole fix — the numbers were never wrong. */}
                <p className="px-1 text-xs leading-relaxed text-foreground-subtle">
                  From the {stats.appearances} completed {stats.appearances === 1 ? "match" : "matches"} KIVO holds for{" "}
                  {displayName}, across all competitions. The by-competition table below splits the same career up
                  league by league, and will differ wherever KIVO holds only part of a season.
                </p>
              </div>
            </Section>
          )}

          <PlayerSeasonStatisticsPanel playerId={player.id} />
        </>
      ),
    });
  }

  // No admin branch here on purpose. This tab used to be offered to staff with
  // no transfers to show, purely to carry a "Sync transfers" button — an
  // internal control living on a fan-facing page. It is triggered per club from
  // Admin instead, on a cheaper endpoint (one request for a club's whole
  // history rather than one per player). The freshness line it sat next to is a
  // real fact for a reader and stays.
  if ((transfers ?? []).length > 0) {
    tabs.push({
      id: "transfers",
      label: "Transfers",
      count: transfers!.length,
      content: (
        <Section title="Transfer history" action={<LastSyncedNote timestamp={transfersLastSyncedAt} />}>
          <ListSurface>
            {(transfers ?? []).map((transfer) => (
                <li key={transfer.id} className="flex flex-col gap-2 px-4 py-3">
                  <span className="flex items-center gap-2">
                    <ClubSide team={transfer.from_team} />
                    <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-foreground-subtle" strokeWidth={2} />
                    <ClubSide team={transfer.to_team} />
                  </span>
                  <span className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <span className="rounded-full border border-hairline px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-foreground-muted">
                        {TRANSFER_TYPE_LABEL[transfer.transfer_type]}
                      </span>
                      <span className="text-[11px] text-foreground-subtle">
                        {formatDate(transfer.transfer_date, { month: "short" })}
                      </span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      {transfer.fee_text ?? "–"}
                    </span>
                  </span>
                </li>
              ))}
          </ListSurface>
        </Section>
      ),
    });
  }

  return (
    <div className="kivo-page">
      <TrackView type="player" id={player.id} name={displayName} imageUrl={player.photo_url} />

      <PlayerHeader
        name={displayName}
        fullName={player.full_name}
        photoUrl={player.photo_url}
        position={player.position}
        nationality={player.nationality}
        dateOfBirth={player.date_of_birth}
        club={
          player.current_team
            ? {
                id: player.current_team.id,
                name: player.current_team.name,
                shortName: player.current_team.short_name,
                crestUrl: player.current_team.crest_url,
              }
            : null
        }
        headline={headline}
        actions={
          <>
            <SaveButton
              targetType="player"
              targetId={player.id}
              initialSaved={isSaved}
              signedIn={viewerIsSignedIn(profile)}
            />
            <FollowWithMute
              targetType="player"
              targetId={player.id}
              initialFollowing={isFollowing}
              initialMuted={isMuted}
              signedIn={viewerIsSignedIn(profile)}
            />
          </>
        }
        footer={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link
              href={`/players/compare?a=${player.id}`}
              className="kivo-focus flex items-center gap-1.5 text-xs font-medium text-accent transition hover:text-accent/80"
            >
              <GitCompareArrows className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              Compare
            </Link>
            <AskAiLink ctx="player" id={player.id} label={`Ask AI about ${displayName}`} />
          </div>
        }
      />

      <FadeIn delay={0.22}>
        <EntityTabs tabs={tabs} ariaLabel={`${displayName} sections`} idPrefix="player" />
      </FadeIn>
    </div>
  );
}

/** One club on a transfer row. A transfer whose other side KIVO does not hold
 * still happened, so the row renders with the side it knows and says the other
 * is not listed rather than dropping the transfer entirely. */
function ClubSide({
  team,
}: {
  team: { id: string; name: string; short_name: string | null; crest_url: string | null } | null;
}) {
  if (!team) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2 text-xs text-foreground-subtle">
        <TeamCrest crestUrl={null} name="" size={18} />
        Club not listed
      </span>
    );
  }
  return (
    <Link
      href={`/teams/${team.id}`}
      className="kivo-focus flex min-w-0 flex-1 items-center gap-2 text-xs text-foreground transition hover:text-accent"
    >
      <TeamCrest crestUrl={team.crest_url} name={team.name} size={18} />
      <span className="truncate">{team.short_name ?? team.name}</span>
    </Link>
  );
}

/** The Overview's three-row taste of the match log. Deliberately the same rows
 * the Matches tab renders — a preview that reformats its rows teaches the
 * reader two layouts for one list. */
function MatchLogPreview({ rows }: { rows: MatchLogRow[] }) {
  return (
    <>
      {rows.map((row) => (
        <li key={row.fixtureId}>
          <Link
            href={`/matches/${row.fixtureId}`}
            className="kivo-focus flex min-h-11 items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-surface-2 motion-reduce:transition-none"
          >
            <TeamCrest crestUrl={row.opponentCrestUrl} name={row.opponentName} size={22} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">
                {row.opponentShortName ?? row.opponentName}
              </span>
              <span className="block truncate text-[11px] text-foreground-subtle">
                {[formatDate(row.kickoffAt, { month: "short" }), row.competitionLabel].filter(Boolean).join(" · ")}
              </span>
            </span>
            {row.ownScore !== null && row.oppScore !== null && (
              <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                {row.ownScore}–{row.oppScore}
              </span>
            )}
          </Link>
        </li>
      ))}
    </>
  );
}
