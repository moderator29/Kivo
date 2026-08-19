import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Shield, Flag, Cake, Activity, ArrowLeftRight, GitCompareArrows, LineChart, Trophy } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { triggerPlayerTransfersSync } from "@/app/admin/data-health/actions";
import { FadeIn } from "@/components/ui/fade-in";
import { YourPlayerConnection } from "@/components/football/your-connection-card";
import { getViewerPlayerConnection } from "@/lib/football/viewer-connection";
import { FollowWithMute } from "@/components/ui/follow-with-mute";
import { SaveButton } from "@/components/ui/save-button";
import { InlineSyncButton } from "@/components/admin/inline-sync-button";
import { LastSyncedNote } from "@/components/football/last-synced-note";
import { AskAiLink } from "@/components/ai/ask-ai-link";
import { TeamCrest } from "@/components/ui/team-crest";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { TrackView } from "@/components/ui/track-view";
import { FormBadges } from "@/components/teams/form-badges";
import { getLastSyncedAt } from "@/lib/football/last-synced";
import { ShareCardPanel } from "@/components/share/share-card-panel";
import { TRANSFER_TYPE_LABEL } from "@/lib/football/transfer-labels";
import { computePlayerMatchStats } from "@/lib/football/player-stats";
import { computePlayerForm, resolveFixtureResult, type ResolvedResult } from "@/lib/football/form-engine";
import { calculateAge, formatDate } from "@/lib/format";
import { ensureFantasyPlayerPrices, getFantasyPriceMap } from "@/lib/fantasy";
import { viewerIsSignedIn } from "@/lib/guest-preview";
import { DEFAULT_FANTASY_PRICE, formatFantasyPrice } from "@/app/(app)/fantasy/fantasy-rules";
import { PlayerAbsenceNote } from "@/components/football/absences-panel";
import { PlayerSeasonStatisticsPanel } from "@/components/football/season-statistics-panel";

// RECOMMENDATIONS.md item 296: same minimum-sample suppression convention as
// this document's other real-but-thin aggregates (items 168/170/250) — a
// gameweek with only a handful of total fantasy picks league-wide shouldn't
// render a precise-looking ownership percentage.
const MIN_FANTASY_OWNERSHIP_SAMPLE = 10;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = createServerSupabaseClient();
  const { data: player } = await supabase.from("players").select("known_as, full_name").eq("id", id).maybeSingle();
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

  const [{ data: player }, { data: lineupRows }, { data: eventRows }, { data: transfers }, { data: followRow }, isSaved, transfersLastSyncedAt] = await Promise.all([
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
         fixture:fixtures(id, status, kickoff_at, home_team_id, away_team_id, home_score, away_score)`,
      )
      .eq("player_id", id),
    supabase
      .from("fixture_events")
      .select("event_type")
      .eq("player_id", id),
    supabase
      .from("transfers")
      .select(
        `id, transfer_date, fee_text, transfer_type,
         from_team:teams!transfers_from_team_id_fkey(id, name, short_name, crest_url),
         to_team:teams!transfers_to_team_id_fkey(id, name, short_name, crest_url)`,
      )
      .eq("player_id", id)
      .order("transfer_date", { ascending: false }),
    // RECOMMENDATIONS.md item 287: selecting `muted` (not a head-count) so
    // the same row also carries this viewer's per-player mute state for
    // FollowWithMute — a plain existence check would lose it.
    profile
      ? supabase
          .from("follows")
          .select("muted")
          .eq("follower_profile_id", profile.id)
          .eq("followed_type", "player")
          .eq("followed_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // RECOMMENDATIONS.md item 173: player watchlist — real save state,
    // saves_select_own already scopes this to the caller's own row.
    profile
      ? supabase
          .from("saves")
          .select("id", { count: "exact", head: true })
          .eq("profile_id", profile.id)
          .eq("target_type", "player")
          .eq("target_id", id)
          .then(({ count }) => (count ?? 0) > 0)
      : Promise.resolve(false),
    // RECOMMENDATIONS.md item 60: transfer sync writes entity_type 'transfer'
    // (see syncPlayerTransfers in src/lib/football/sync-transfers.ts).
    getLastSyncedAt(["transfer"]),
  ]);

  if (!player) notFound();

  // RECOMMENDATIONS.md item 296: real fantasy price + ownership, only once a
  // current season is resolvable for this player's current club — same
  // team -> standings -> seasons(is_current) pattern teams/[id]/page.tsx
  // already uses to find "the" current season for a team (a player has no
  // season/standings row of its own to read this off directly).
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
    // Lazily backfills the flat default if this player has never had a
    // fantasy_player_prices row for this season (same convention every
    // other real reader of this table already follows), then reads whatever
    // its real current price is — dynamic since RECOMMENDATIONS.md item 251
    // (see fantasy-pricing.ts), the flat default otherwise.
    await ensureFantasyPlayerPrices(fantasySeasonId, [player.id]);
    const [priceMap, { data: ownershipRows }] = await Promise.all([
      getFantasyPriceMap(fantasySeasonId, [player.id]),
      // Narrow SECURITY DEFINER RPC (migration 0051) over fantasy_rosters —
      // fantasy_rosters_all_own is owner-only, so a plain cross-user query
      // can't compute this, same reasoning get_prediction_consensus already
      // established for a different table.
      supabase.rpc("get_fantasy_ownership", { p_player_id: player.id, p_season_id: fantasySeasonId }),
    ]);
    fantasyPrice = priceMap.get(player.id) ?? DEFAULT_FANTASY_PRICE;
    const ownershipRow = ownershipRows?.[0];
    if (ownershipRow) {
      fantasyOwnership = { playerCount: ownershipRow.player_count, totalCount: ownershipRow.total_count };
    }
  }
  const hasMeaningfulOwnership = fantasyOwnership !== null && fantasyOwnership.totalCount >= MIN_FANTASY_OWNERSHIP_SAMPLE;
  const ownershipPct = hasMeaningfulOwnership
    ? Math.round((fantasyOwnership!.playerCount / fantasyOwnership!.totalCount) * 100)
    : null;

  const isFollowing = followRow !== null;
  const isMuted = followRow?.muted ?? false;

  // KN-46: the same page for a stranger and for the manager who has this
  // player as their captain this gameweek. One targeted, owner-scoped read
  // fixes that; it renders nothing when the player isn't in the viewer's squad.
  const viewerConnection = profile ? await getViewerPlayerConnection(supabase, profile.id, player.id) : null;

  const stats = computePlayerMatchStats(lineupRows ?? [], eventRows ?? []);
  const hasMatchData = stats.appearances > 0;

  // KIVO Form Engine (src/lib/football/form-engine.ts): each lineups row
  // already carries the team_id this player was named for in that fixture,
  // so it resolves to the same "own vs opponent score" shape team form uses
  // (teams/[id]/page.tsx) rather than a per-player individual result, which
  // doesn't exist in football — a player shares their team's real result.
  // Sorted newest-first client-side (bounded row count: one per fixture this
  // player has ever been named in a lineup for) rather than a second
  // DB round trip just to order by a joined column.
  const playerResultsNewestFirst: ResolvedResult[] = (lineupRows ?? [])
    .flatMap((row) => {
      if (!row.fixture) return [];
      const resolved = resolveFixtureResult(
        {
          id: row.fixture.id,
          kickoff_at: row.fixture.kickoff_at,
          status: row.fixture.status,
          home_score: row.fixture.home_score,
          away_score: row.fixture.away_score,
          home_team_id: row.fixture.home_team_id,
          away_team_id: row.fixture.away_team_id,
        },
        row.team_id,
      );
      return resolved ? [resolved] : [];
    })
    .sort((a, b) => new Date(b.kickoffAt).getTime() - new Date(a.kickoffAt).getTime());
  const recentForm = computePlayerForm(playerResultsNewestFirst, "last5");

  const displayName = player.known_as ?? player.full_name;
  const showFullNameSubtitle = Boolean(player.known_as) && player.known_as !== player.full_name;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <TrackView type="player" id={player.id} name={displayName} imageUrl={player.photo_url} />
      <div className="kivo-glass-brand rounded-2xl p-6">
        <div className="flex items-center gap-4">
          <FadeIn delay={0} className="shrink-0">
            <PlayerAvatar photoUrl={player.photo_url} name={displayName} size={64} />
          </FadeIn>
          <FadeIn delay={0.05} className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold text-foreground">{displayName}</h1>
            {showFullNameSubtitle && <p className="truncate text-xs text-foreground-subtle">{player.full_name}</p>}
            {player.position && (
              <span className="mt-1 inline-block rounded-full border border-hairline px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
                {player.position}
              </span>
            )}
          </FadeIn>
          <FadeIn delay={0.1} className="flex items-center gap-2">
            <SaveButton targetType="player" targetId={player.id} initialSaved={isSaved} signedIn={viewerIsSignedIn(profile)} />
            <FollowWithMute
              targetType="player"
              targetId={player.id}
              initialFollowing={isFollowing}
              initialMuted={isMuted}
              signedIn={viewerIsSignedIn(profile)}
            />
          </FadeIn>
        </div>

        <FadeIn delay={0.15} className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2 text-sm text-foreground-muted">
            <Flag className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
            {player.nationality ?? "Nationality not yet synced"}
          </div>
          <div className="flex items-center gap-2 text-sm text-foreground-muted">
            <Cake className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
            {player.date_of_birth
              ? `${formatDate(player.date_of_birth)} (age ${calculateAge(player.date_of_birth)})`
              : "Date of birth not yet synced"}
          </div>
        </FadeIn>
        <FadeIn delay={0.18}>
          <Link
            href={`/players/compare?a=${player.id}`}
            className="mt-4 flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent/80"
          >
            <GitCompareArrows className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            Compare with another player
          </Link>
        </FadeIn>
        {/* RECOMMENDATIONS.md items 184/185: real, player-scoped AI grounding
            entry point — see ask-ai-link.tsx. */}
        <FadeIn delay={0.2}>
          <AskAiLink ctx="player" id={player.id} label={`Ask AI about ${displayName}`} />
        </FadeIn>
      </div>

      {/* Above everything else about this player, because whether they are
          currently available changes how every number below it should be read.
          Renders nothing at all when there is no report — an "available" badge
          would be a fitness claim KIVO cannot make, since the absence of a
          report is not evidence of fitness. */}
      <PlayerAbsenceNote playerId={player.id} />

      {viewerConnection && (
        <FadeIn delay={0.18}>
          <YourPlayerConnection connection={viewerConnection} />
        </FadeIn>
      )}

      {/* The provider's own per-competition season aggregates. Renders nothing
          when none are synced — the match log below is already built from
          KIVO's own fixtures, and two empty panels would say the same nothing
          twice. */}
      <PlayerSeasonStatisticsPanel playerId={player.id} />

      <FadeIn delay={0.2} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <Shield className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Current club
        </h2>
        {player.current_team ? (
          <Link
            href={`/teams/${player.current_team.id}`}
            className="kivo-glass kivo-glass-interactive flex items-center gap-3 rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:bg-surface-2"
          >
            <TeamCrest crestUrl={player.current_team.crest_url} name={player.current_team.name} />
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">{player.current_team.name}</p>
              {player.current_team.short_name && (
                <p className="truncate text-[11px] text-foreground-subtle">{player.current_team.short_name}</p>
              )}
            </div>
          </Link>
        ) : (
          <div className="kivo-glass rounded-2xl p-5 text-center text-sm text-foreground-muted">
            No current club on record.
          </div>
        )}
      </FadeIn>

      {/* RECOMMENDATIONS.md item 296: only rendered once a current season is
          resolvable for this player's club — a player with no synced
          current club (or a club not in any currently-running season) has
          nothing real to price against. */}
      {fantasySeasonId && fantasyPrice !== null && (
        <FadeIn delay={0.22} className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
            <Trophy className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
            Fantasy
          </h2>
          <div className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-2xl font-semibold tabular-nums text-foreground">{formatFantasyPrice(fantasyPrice)}</p>
                <p className="text-[11px] text-foreground-subtle">Current KIVO fantasy price</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-semibold tabular-nums text-foreground">
                  {ownershipPct !== null ? `${ownershipPct}%` : "-"}
                </p>
                <p className="text-[11px] text-foreground-subtle">
                  {ownershipPct !== null ? "Rostered this gameweek" : "Not enough squads yet"}
                </p>
              </div>
            </div>
            <p className="border-t border-white/5 pt-3 text-xs text-foreground-subtle">
              KIVO&apos;s own internal fantasy-game currency — not a real transfer-market value — moves in small,
              capped steps based on this player&apos;s real recent match performance relative to their position group.
            </p>
            <Link
              href="/fantasy"
              className="flex items-center gap-1.5 text-xs font-medium text-kivo-cyan hover:text-kivo-cyan/80"
            >
              <Trophy className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              Build your fantasy squad
            </Link>
          </div>
        </FadeIn>
      )}

      <FadeIn delay={0.25} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <Activity className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Season stats
        </h2>
        {hasMatchData ? (
          <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-5">
            {[
              ["Apps", stats.appearances],
              ["Starts", stats.starts],
              ["Goals", stats.goals],
              ["Yellow", stats.yellowCards],
              ["Red", stats.redCards],
            ].map(([label, value]) => (
              <div key={label as string} className="kivo-glass rounded-xl px-2 py-3">
                <div className="text-lg font-semibold text-foreground">{value}</div>
                <div className="text-[11px] uppercase tracking-wide text-foreground-subtle">{label}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="kivo-glass rounded-2xl p-5 text-center text-sm text-foreground-muted">
            No match data yet.
          </div>
        )}
      </FadeIn>

      <FadeIn delay={0.28} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <LineChart className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Recent form
        </h2>
        {recentForm.isSufficientSample ? (
          <div className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
            <FormBadges form={recentForm.sequence} />
            <p className="text-xs text-foreground-subtle">
              {displayName}&apos;s team in the {recentForm.sampleSize} most recent finished match
              {recentForm.sampleSize === 1 ? "" : "es"} they were named in the squad for:{" "}
              {recentForm.wins}W {recentForm.draws}D {recentForm.losses}L · {recentForm.goalsScored} scored,{" "}
              {recentForm.goalsConceded} conceded.
            </p>
          </div>
        ) : (
          <div className="kivo-glass rounded-2xl p-5 text-center text-sm text-foreground-muted">
            {playerResultsNewestFirst.length > 0
              ? `Only ${playerResultsNewestFirst.length} finished match${playerResultsNewestFirst.length === 1 ? "" : "es"} synced for ${displayName} so far — not enough real matches yet for a reliable form trend.`
              : `No finished matches synced yet for ${displayName}.`}
          </div>
        )}
      </FadeIn>

      <FadeIn delay={0.3} className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
            <ArrowLeftRight className="h-4 w-4 text-accent" strokeWidth={1.75} />
            Transfer history
          </h2>
          <LastSyncedNote timestamp={transfersLastSyncedAt} />
        </div>
        {transfers && transfers.length > 0 ? (
          <div className="flex flex-col gap-2">
            {transfers.map((transfer) => (
              <div
                key={transfer.id}
                className="kivo-glass flex flex-col gap-3 rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:bg-surface-2"
              >
                <div className="flex items-center gap-2">
                  {transfer.from_team ? (
                    <Link
                      href={`/teams/${transfer.from_team.id}`}
                      className="flex min-w-0 flex-1 items-center gap-2 text-xs text-foreground transition hover:text-accent"
                    >
                      <TeamCrest crestUrl={transfer.from_team.crest_url} name={transfer.from_team.name} />
                      <span className="truncate">{transfer.from_team.short_name ?? transfer.from_team.name}</span>
                    </Link>
                  ) : (
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-xs text-foreground-subtle">
                      <TeamCrest crestUrl={null} name="" />
                      Club not synced
                    </span>
                  )}
                  <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-foreground-subtle" strokeWidth={2} />
                  {transfer.to_team ? (
                    <Link
                      href={`/teams/${transfer.to_team.id}`}
                      className="flex min-w-0 flex-1 items-center gap-2 text-xs text-foreground transition hover:text-accent"
                    >
                      <TeamCrest crestUrl={transfer.to_team.crest_url} name={transfer.to_team.name} />
                      <span className="truncate">{transfer.to_team.short_name ?? transfer.to_team.name}</span>
                    </Link>
                  ) : (
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-xs text-foreground-subtle">
                      <TeamCrest crestUrl={null} name="" />
                      Club not synced
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-hairline-soft pt-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-hairline px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
                      {TRANSFER_TYPE_LABEL[transfer.transfer_type]}
                    </span>
                    <span className="text-[11px] text-foreground-subtle">{formatDate(transfer.transfer_date)}</span>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-foreground">{transfer.fee_text ?? "-"}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-5 text-center text-sm text-foreground-muted">
            No transfer history synced for this player yet.
            {canManageFootballData(profile?.role) && (
              <InlineSyncButton
                label="Sync transfers"
                action={triggerPlayerTransfersSync.bind(null, player.id)}
                hint="Needs this player's team squad synced first, so this player has a provider mapping."
              />
            )}
          </div>
        )}
      </FadeIn>

      {/* Renders nothing at all if KIVO has no synced numbers for this player
          — an empty card is not worth offering. */}
      <FadeIn delay={0.16} className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
        <ShareCardPanel
          kind="player-performance"
          id={player.id}
          shareUrl={`/players/${player.id}`}
          shareText={`${player.known_as ?? player.full_name} on KIVO.`}
          heading="Share this player"
          description="Pick a background. The preview is the exact image you save."
        />
      </FadeIn>
    </div>
  );
}
