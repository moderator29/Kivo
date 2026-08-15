import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Shield, Flag, Cake, Activity, ArrowLeftRight, GitCompareArrows, Wallet, FileClock } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { triggerPlayerTransfersSync } from "@/app/admin/data-health/actions";
import { FadeIn } from "@/components/ui/fade-in";
import { FollowButton } from "@/components/ui/follow-button";
import { SaveButton } from "@/components/ui/save-button";
import { InlineSyncButton } from "@/components/admin/inline-sync-button";
import { LastSyncedNote } from "@/components/football/last-synced-note";
import { TeamCrest } from "@/components/ui/team-crest";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { TrackView } from "@/components/ui/track-view";
import { getLastSyncedAt } from "@/lib/football/last-synced";
import { TRANSFER_TYPE_LABEL } from "@/lib/football/transfer-labels";
import { computePlayerMatchStats } from "@/lib/football/player-stats";
import { calculateAge, formatDate, formatMarketValueEur } from "@/lib/format";
import { isPreviewModeActive } from "@/lib/preview-mode";
import { PREVIEW_FIELD_CLASSNAME, PreviewAsterisk } from "@/components/ui/preview-marker";

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
  // Admin-only, opt-in-only — see src/lib/preview-mode.ts. False for every
  // guest and every non-admin regardless of anything in the request.
  const previewMode = await isPreviewModeActive(profile);

  const [{ data: player }, { data: lineupRows }, { data: eventRows }, { data: transfers }, isFollowing, isSaved, transfersLastSyncedAt] = await Promise.all([
    supabase
      .from("players")
      .select(
        `id, full_name, known_as, date_of_birth, nationality, position, photo_url, current_team_id,
         market_value_eur, market_value_updated_at, contract_expires_at,
         current_team:teams(id, name, short_name, crest_url)`,
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("lineups")
      .select("id, is_starting, fixture:fixtures(status)")
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
    profile
      ? supabase
          .from("follows")
          .select("id", { count: "exact", head: true })
          .eq("follower_profile_id", profile.id)
          .eq("followed_type", "player")
          .eq("followed_id", id)
          .then(({ count }) => (count ?? 0) > 0)
      : Promise.resolve(false),
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

  const stats = computePlayerMatchStats(lineupRows ?? [], eventRows ?? []);
  const hasMatchData = stats.appearances > 0;

  const displayName = player.known_as ?? player.full_name;
  const showFullNameSubtitle = Boolean(player.known_as) && player.known_as !== player.full_name;

  // Preview mode only ever fills in a field that is genuinely null today —
  // it never overrides a real value, and it's computed fresh per-request
  // from previewMode above (admin + opt-in only). See supabase/migrations/
  // 0036_premium_stats_readiness.sql for why these two columns are null for
  // every player right now, and src/lib/preview-mode.ts for the safety
  // contract. Every faked value here MUST stay wrapped in PreviewAsterisk /
  // PREVIEW_FIELD_CLASSNAME so it can never be mistaken for a real one.
  const marketValueIsFake = previewMode && player.market_value_eur == null;
  const marketValueEur = player.market_value_eur ?? (previewMode ? 42_500_000 : null);
  const marketValueUpdatedAt = player.market_value_eur != null ? player.market_value_updated_at : marketValueIsFake ? new Date().toISOString() : null;

  const contractIsFake = previewMode && player.contract_expires_at == null;
  const contractExpiresAt = player.contract_expires_at ?? (previewMode ? "2028-06-30" : null);

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
              <span className="mt-1 inline-block rounded-full border border-white/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
                {player.position}
              </span>
            )}
          </FadeIn>
          <FadeIn delay={0.1} className="flex items-center gap-2">
            <SaveButton targetType="player" targetId={player.id} initialSaved={isSaved} signedIn={!!profile} />
            <FollowButton targetType="player" targetId={player.id} initialFollowing={isFollowing} signedIn={!!profile} />
          </FadeIn>
        </div>

        <FadeIn delay={0.15} className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2 text-sm text-foreground-muted">
            <Flag className="h-4 w-4 shrink-0 text-kivo-cyan" strokeWidth={1.75} />
            {player.nationality ?? "Nationality not yet synced"}
          </div>
          <div className="flex items-center gap-2 text-sm text-foreground-muted">
            <Cake className="h-4 w-4 shrink-0 text-kivo-cyan" strokeWidth={1.75} />
            {player.date_of_birth
              ? `${formatDate(player.date_of_birth)} (age ${calculateAge(player.date_of_birth)})`
              : "Date of birth not yet synced"}
          </div>
        </FadeIn>
        <FadeIn delay={0.18}>
          <Link
            href={`/players/compare?a=${player.id}`}
            className="mt-4 flex items-center gap-1.5 text-xs font-medium text-kivo-cyan hover:text-kivo-cyan/80"
          >
            <GitCompareArrows className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            Compare with another player
          </Link>
        </FadeIn>
      </div>

      <FadeIn delay={0.2} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <Shield className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
          Current club
        </h2>
        {player.current_team ? (
          <Link
            href={`/teams/${player.current_team.id}`}
            className="kivo-glass flex items-center gap-3 rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:bg-white/[0.06]"
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

      {(marketValueEur != null || contractExpiresAt != null) && (
        // Real vendor data (supabase/migrations/0036_premium_stats_readiness.sql)
        // — this section stays invisible until a premium provider is connected
        // and has actually written a value for this player, UNLESS an admin has
        // turned preview mode on (src/lib/preview-mode.ts), in which case a null
        // field renders with an obviously-marked sample value instead. A real
        // value, when one exists, always renders unmarked exactly as before.
        <FadeIn delay={0.22} className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
            <Wallet className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
            Market
            {(marketValueIsFake || contractIsFake) && (
              <span className="rounded-full border border-dashed border-amber-400/70 bg-amber-400/[0.06] px-2 py-0.5 text-[10px] font-bold normal-case tracking-normal text-amber-400">
                Preview data
              </span>
            )}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {marketValueEur != null && (
              <div
                className={`kivo-glass flex items-center gap-2 rounded-2xl p-4 text-sm text-foreground-muted ${marketValueIsFake ? PREVIEW_FIELD_CLASSNAME : ""}`}
              >
                <Wallet className="h-4 w-4 shrink-0 text-kivo-cyan" strokeWidth={1.75} />
                <div>
                  <div className="text-foreground">
                    {formatMarketValueEur(marketValueEur)}
                    {marketValueIsFake && <PreviewAsterisk />}
                  </div>
                  {marketValueUpdatedAt && (
                    <div className="text-[11px] text-foreground-subtle">
                      {marketValueIsFake ? "Sample as of" : "Updated"} {formatDate(marketValueUpdatedAt)}
                    </div>
                  )}
                </div>
              </div>
            )}
            {contractExpiresAt != null && (
              <div
                className={`kivo-glass flex items-center gap-2 rounded-2xl p-4 text-sm text-foreground-muted ${contractIsFake ? PREVIEW_FIELD_CLASSNAME : ""}`}
              >
                <FileClock className="h-4 w-4 shrink-0 text-kivo-cyan" strokeWidth={1.75} />
                <div className="text-foreground">
                  Contract until {formatDate(contractExpiresAt)}
                  {contractIsFake && <PreviewAsterisk />}
                </div>
              </div>
            )}
          </div>
        </FadeIn>
      )}

      <FadeIn delay={0.25} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <Activity className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
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

      <FadeIn delay={0.3} className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
            <ArrowLeftRight className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
            Transfer history
          </h2>
          <LastSyncedNote timestamp={transfersLastSyncedAt} />
        </div>
        {transfers && transfers.length > 0 ? (
          <div className="flex flex-col gap-2">
            {transfers.map((transfer) => (
              <div
                key={transfer.id}
                className="kivo-glass flex flex-col gap-3 rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:bg-white/[0.06]"
              >
                <div className="flex items-center gap-2">
                  {transfer.from_team ? (
                    <Link
                      href={`/teams/${transfer.from_team.id}`}
                      className="flex min-w-0 flex-1 items-center gap-2 text-xs text-foreground transition hover:text-kivo-cyan"
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
                  <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
                  {transfer.to_team ? (
                    <Link
                      href={`/teams/${transfer.to_team.id}`}
                      className="flex min-w-0 flex-1 items-center gap-2 text-xs text-foreground transition hover:text-kivo-cyan"
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
                <div className="flex items-center justify-between gap-3 border-t border-white/5 pt-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
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
    </div>
  );
}
