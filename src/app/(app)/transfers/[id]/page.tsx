import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, BadgeCheck, Bell, Clock, Users } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { parseUuidParam } from "@/lib/params";
import { viewerIsSignedIn } from "@/lib/guest-preview";
import { FadeIn } from "@/components/ui/fade-in";
import { TeamCrest } from "@/components/ui/team-crest";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { FollowWithMute } from "@/components/ui/follow-with-mute";
import { RelativeTime } from "@/components/ui/relative-time";
import { ShareCardPanel } from "@/components/share/share-card-panel";
import { TRANSFER_TYPE_LABEL } from "@/lib/football/transfer-labels";
import { TRANSFER_STATUS_EXPLAINER, TRANSFER_STATUS_LABEL } from "@/lib/football/transfer-status";
import { loadTransferContext } from "@/lib/football/transfer-context";
import { formatDate } from "@/lib/format";

/**
 * One recorded transfer, in full — the Transfer Centre's depth page.
 *
 * The founding directive asks this surface for status, source, timestamp, a
 * transfer timeline, player fit, club need, a window countdown and follow
 * alerts. Seven of those are here and real. The eighth, the four-tier
 * confidence taxonomy, is deliberately absent and explained rather than
 * invented — see `transfer-status.ts` and RECOMMENDATIONS.md item 178.
 *
 * "Player fit" and "club need" are the two that could most easily have become
 * fabrication. They are rendered here strictly as counted facts with their
 * sample stated — how many players KIVO has synced for the destination club,
 * how many of those play the same position, and the club's real league line —
 * never as a verdict on whether the move is a good one. KIVO has no data that
 * could support that verdict, so it does not offer one.
 */

const TRANSFER_SELECT = `
  id, transfer_date, fee_text, transfer_type,
  player:players(id, full_name, known_as, photo_url, position, nationality),
  from_team:teams!transfers_from_team_id_fkey(id, name, short_name, crest_url),
  to_team:teams!transfers_to_team_id_fkey(id, name, short_name, crest_url)
`;

type TransferDetailRow = {
  id: string;
  transfer_date: string;
  fee_text: string | null;
  transfer_type: keyof typeof TRANSFER_TYPE_LABEL;
  player: { id: string; full_name: string; known_as: string | null; photo_url: string | null; position: string | null; nationality: string | null } | null;
  from_team: { id: string; name: string; short_name: string | null; crest_url: string | null } | null;
  to_team: { id: string; name: string; short_name: string | null; crest_url: string | null } | null;
};

async function loadTransfer(id: string): Promise<TransferDetailRow | null> {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase.from("transfers").select(TRANSFER_SELECT).eq("id", id).maybeSingle();
  return (data as unknown as TransferDetailRow) ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const transfer = await loadTransfer(parseUuidParam(id));
  if (!transfer?.player) return { title: "Transfer" };
  const name = transfer.player.known_as ?? transfer.player.full_name;
  const destination = transfer.to_team?.name;
  return { title: destination ? `${name} to ${destination}` : name };
}

function ClubSide({
  label,
  team,
}: {
  label: string;
  team: { id: string; name: string; crest_url: string | null } | null;
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-2 text-center">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">{label}</span>
      {team ? (
        <Link href={`/teams/${team.id}`} className="kivo-focus flex flex-col items-center gap-2">
          <TeamCrest crestUrl={team.crest_url} name={team.name} size={48} />
          <span className="text-sm font-semibold text-foreground">{team.name}</span>
        </Link>
      ) : (
        <>
          <TeamCrest crestUrl={null} name={null} size={48} />
          {/* Not "Free agent" — KIVO does not know that. It knows only that
              this side of the move references a club it has not synced. */}
          <span className="text-sm text-foreground-subtle">Club not synced</span>
        </>
      )}
    </div>
  );
}

export default async function TransferDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = parseUuidParam(rawId);

  const transfer = await loadTransfer(id);
  if (!transfer?.player) notFound();

  const supabase = createServerSupabaseClient();
  const profile = await getOrCreateProfile();
  const player = transfer.player;
  const playerName = player.known_as ?? player.full_name;

  const [context, { data: playerFollow }, { data: destinationFollow }] = await Promise.all([
    loadTransferContext(supabase, {
      transferId: transfer.id,
      playerId: player.id,
      playerPosition: player.position,
      toTeamId: transfer.to_team?.id ?? null,
      toTeamName: transfer.to_team?.name ?? null,
    }),
    profile
      ? supabase
          .from("follows")
          .select("muted")
          .eq("follower_profile_id", profile.id)
          .eq("followed_type", "player")
          .eq("followed_id", player.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    profile && transfer.to_team
      ? supabase
          .from("follows")
          .select("muted")
          .eq("follower_profile_id", profile.id)
          .eq("followed_type", "team")
          .eq("followed_id", transfer.to_team.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const signedIn = viewerIsSignedIn(profile);
  const squad = context.destinationSquad;
  const leagueLine = context.destinationLeagueLine;
  const record = context.playerRecord;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn className="flex items-center justify-between gap-3">
        <Link
          href="/transfers"
          className="kivo-focus flex items-center gap-1 text-xs text-foreground-subtle underline decoration-hairline-strong underline-offset-4 hover:text-foreground-muted"
        >
          <ArrowLeft className="h-3 w-3" strokeWidth={2} />
          Transfer Centre
        </Link>
        <span className="flex items-center gap-1.5 rounded-full border border-live/40 bg-live/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-live">
          <BadgeCheck className="h-3.5 w-3.5" strokeWidth={2} />
          {TRANSFER_STATUS_LABEL}
        </span>
      </FadeIn>

      <FadeIn delay={0.03} className="kivo-glass flex flex-col gap-5 rounded-3xl p-5">
        <div className="flex items-center gap-4">
          <Link href={`/players/${player.id}`} className="kivo-focus shrink-0">
            <PlayerAvatar photoUrl={player.photo_url} name={playerName} size={64} />
          </Link>
          <div className="flex min-w-0 flex-col gap-1">
            <Link href={`/players/${player.id}`} className="kivo-focus truncate text-lg font-semibold text-foreground">
              {playerName}
            </Link>
            <span className="truncate text-xs text-foreground-muted">
              {[player.position, player.nationality].filter(Boolean).join(" · ") || "Position not synced"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl border border-hairline bg-surface-1 p-4">
          <ClubSide label="From" team={transfer.from_team} />
          <ArrowRight className="h-5 w-5 shrink-0 text-accent" strokeWidth={1.75} />
          <ClubSide label="To" team={transfer.to_team} />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded-full border border-hairline px-2.5 py-1 font-semibold uppercase tracking-wide text-foreground-muted">
            {TRANSFER_TYPE_LABEL[transfer.transfer_type]}
          </span>
          <span className="rounded-full border border-hairline px-2.5 py-1 text-foreground-muted">
            {formatDate(transfer.transfer_date)}
          </span>
          {/* The fee is the provider's own string, printed verbatim or not at
              all. An undisclosed fee is not a zero and is not "free". */}
          {transfer.fee_text && (
            <span className="rounded-full border border-achievement/40 bg-achievement/10 px-2.5 py-1 font-semibold text-achievement">
              {transfer.fee_text}
            </span>
          )}
        </div>

        <p className="rounded-2xl border border-hairline-soft bg-surface-1 p-3 text-[11px] leading-relaxed text-foreground-subtle">
          {TRANSFER_STATUS_EXPLAINER}
        </p>

        {/* Source and timestamp, from the provider_mappings row the sync
            actually wrote — attribution for this move, not for whichever
            provider happens to be configured today. */}
        {context.source ? (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-foreground-subtle">
            <Clock className="h-3 w-3" strokeWidth={2} />
            <span>
              Source <span className="font-semibold text-foreground-muted">{context.source.provider}</span>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Retrieved by KIVO <RelativeTime iso={context.source.retrievedAt} />
            </span>
          </div>
        ) : (
          <p className="text-[11px] text-foreground-subtle">
            No provider record is mapped to this transfer, so KIVO can&apos;t attribute a source for it.
          </p>
        )}
      </FadeIn>

      {/* Follow alerts. Following either the player or the destination club
          means the next recorded move involving them arrives as a real
          notification (src/lib/football/transfer-notifications.ts), fired from
          the sync's insert branch. */}
      <FadeIn delay={0.06} className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Bell className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Transfer alerts
        </h2>
        <p className="text-xs text-foreground-muted">
          Follow either side and KIVO notifies you the next time it records a move involving them.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-foreground-subtle">{playerName}</span>
            <FollowWithMute
              targetType="player"
              targetId={player.id}
              initialFollowing={Boolean(playerFollow)}
              initialMuted={Boolean(playerFollow?.muted)}
              signedIn={signedIn}
              size="sm"
            />
          </div>
          {transfer.to_team && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-foreground-subtle">{transfer.to_team.name}</span>
              <FollowWithMute
                targetType="team"
                targetId={transfer.to_team.id}
                initialFollowing={Boolean(destinationFollow)}
                initialMuted={Boolean(destinationFollow?.muted)}
                signedIn={signedIn}
                size="sm"
              />
            </div>
          )}
        </div>
      </FadeIn>

      {/* Timeline. A single recorded move renders as a single point rather
          than being padded out into something that looks like a career. */}
      {context.timeline.length > 0 && (
        <FadeIn delay={0.09} className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold text-foreground">{playerName}&apos;s recorded moves</h2>
            <p className="text-xs text-foreground-muted">
              {context.timeline.length === 1
                ? "One move on record. KIVO shows what it has synced, not a full career history."
                : `${context.timeline.length} moves on record, newest first. KIVO shows what it has synced, not a full career history.`}
            </p>
          </div>
          <ol className="flex flex-col gap-0">
            {context.timeline.map((entry, index) => (
              <li key={entry.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${entry.isCurrent ? "bg-accent ring-4 ring-accent/20" : "bg-hairline-strong"}`}
                    aria-hidden="true"
                  />
                  {index < context.timeline.length - 1 && <span className="w-px flex-1 bg-hairline" aria-hidden="true" />}
                </div>
                <div className={`flex min-w-0 flex-1 flex-col gap-0.5 pb-5 ${entry.isCurrent ? "" : "opacity-80"}`}>
                  <span className="text-xs text-foreground-subtle">{formatDate(entry.transferDate)}</span>
                  {entry.isCurrent ? (
                    <span className="truncate text-sm font-semibold text-foreground">
                      {entry.fromTeamName ?? "Club not synced"} → {entry.toTeamName ?? "Club not synced"}
                    </span>
                  ) : (
                    <Link
                      href={`/transfers/${entry.id}`}
                      className="kivo-focus truncate text-sm font-medium text-foreground hover:text-accent"
                    >
                      {entry.fromTeamName ?? "Club not synced"} → {entry.toTeamName ?? "Club not synced"}
                    </Link>
                  )}
                  <span className="text-[11px] text-foreground-subtle">
                    {TRANSFER_TYPE_LABEL[entry.transferType]}
                    {entry.feeText ? ` · ${entry.feeText}` : ""}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </FadeIn>
      )}

      {/* What the data says. Counted facts with their sample stated — never a
          judgement on whether the move makes sense, which KIVO has no data to
          make. Each block disappears entirely rather than rendering zeros. */}
      {(record || squad || leagueLine) && (
        <FadeIn delay={0.12} className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
          <div className="flex flex-col gap-1">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Users className="h-4 w-4 text-accent" strokeWidth={1.75} />
              What the data says
            </h2>
            <p className="text-xs text-foreground-muted">
              Counts from what KIVO has actually synced. Not a verdict on the move — KIVO has no data that could
              support one.
            </p>
          </div>

          {record && (
            <div className="flex flex-col gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
                {playerName}&apos;s record
              </span>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {[
                  { label: "Apps", value: record.appearances },
                  { label: "Starts", value: record.starts },
                  { label: "Goals", value: record.goals },
                  { label: "Yellow", value: record.yellowCards },
                  { label: "Red", value: record.redCards },
                ].map((cell) => (
                  <div key={cell.label} className="flex flex-col items-center rounded-xl border border-hairline bg-surface-1 p-2">
                    <span className="text-base font-semibold tabular-nums text-foreground">{cell.value}</span>
                    <span className="text-[10px] uppercase tracking-wide text-foreground-subtle">{cell.label}</span>
                  </div>
                ))}
              </div>
              <span className="text-[11px] text-foreground-subtle">
                Across every match KIVO has synced for this player. Sync coverage is partial, not a full career record.
              </span>
            </div>
          )}

          {squad && (
            <div className="flex flex-col gap-2 border-t border-hairline-soft pt-4">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
                {squad.teamName}&apos;s squad, as KIVO holds it
              </span>
              <div className="flex flex-wrap gap-2">
                {squad.byPosition.map((entry) => (
                  <span
                    key={entry.group}
                    className="rounded-full border border-hairline px-2.5 py-1 text-[11px] text-foreground-muted"
                  >
                    {entry.group} <span className="font-semibold tabular-nums text-foreground">{entry.count}</span>
                  </span>
                ))}
              </div>
              <span className="text-[11px] text-foreground-subtle">
                {squad.syncedPlayerCount} player{squad.syncedPlayerCount === 1 ? "" : "s"} synced for {squad.teamName}
                {squad.countInPlayerPosition != null && player.position
                  ? `, of whom ${squad.countInPlayerPosition} play ${player.position.toLowerCase()}.`
                  : "."}
              </span>
            </div>
          )}

          {leagueLine && (
            <div className="flex flex-col gap-2 border-t border-hairline-soft pt-4">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground-subtle">
                {transfer.to_team?.name} in {leagueLine.competitionName}
              </span>
              <p className="text-xs leading-relaxed text-foreground-muted">
                {leagueLine.position != null ? `${leagueLine.position}${ordinalSuffix(leagueLine.position)}, ` : ""}
                {leagueLine.points} point{leagueLine.points === 1 ? "" : "s"} from {leagueLine.played} match
                {leagueLine.played === 1 ? "" : "es"} — {leagueLine.goalsFor} scored, {leagueLine.goalsAgainst}{" "}
                conceded, in {leagueLine.seasonName}.
              </p>
            </div>
          )}
        </FadeIn>
      )}

      <FadeIn delay={0.15} className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
        <ShareCardPanel
          kind="transfer"
          id={transfer.id}
          shareUrl={`/transfers/${transfer.id}`}
          shareText={`${playerName}${transfer.to_team ? ` to ${transfer.to_team.name}` : ""} — on KIVO.`}
          heading="Share this move"
          description="Pick a background. The preview is the exact image you save."
        />
      </FadeIn>
    </div>
  );
}

/** Matches the ordinal rule used on the share cards (`ordinal` in
 * src/lib/share-cards/build.ts) — kept as a local suffix helper here because
 * this call site already has the number rendered separately. */
function ordinalSuffix(value: number): string {
  const abs = Math.abs(value) % 100;
  if (abs >= 11 && abs <= 13) return "th";
  return ["th", "st", "nd", "rd"][Math.min(abs % 10, 4)] ?? "th";
}
