import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { UserRound, Shield, Flag, Cake, Activity, ArrowLeftRight } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { triggerPlayerTransfersSync } from "@/app/admin/data-health/actions";
import { FadeIn } from "@/components/ui/fade-in";
import { FollowButton } from "@/components/ui/follow-button";
import { InlineSyncButton } from "@/components/admin/inline-sync-button";
import { TeamCrest } from "@/components/ui/team-crest";
import { TrackView } from "@/components/ui/track-view";
import type { Database } from "@/lib/supabase/types";

type FixtureEventType = Database["public"]["Enums"]["fixture_event_type"];
type TransferType = Database["public"]["Enums"]["transfer_type"];

// Same honesty rule as /transfers — API-Football's transfer data is real,
// already-completed moves only, so labels stay plain, no rumour/confidence tiers.
const TRANSFER_TYPE_LABEL: Record<TransferType, string> = {
  transfer: "Transfer",
  loan: "Loan",
  free: "Free transfer",
  end_of_loan: "End of loan",
  unknown: "Fee undisclosed",
};

// A lineup row against a fixture in any of these statuses means the player has
// actually taken the pitch — "scheduled" fixtures don't count as an appearance yet.
const PLAYED_STATUSES = new Set(["live", "halftime", "finished"]);

function calculateAge(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = createServerSupabaseClient();
  const { data: player } = await supabase.from("players").select("known_as, full_name").eq("id", id).maybeSingle();
  return { title: (player?.known_as ?? player?.full_name) || "Player" };
}

export default async function PlayerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createServerSupabaseClient();
  const profile = await getOrCreateProfile();

  const [{ data: player }, { data: lineupRows }, { data: eventRows }, { data: transfers }, isFollowing] = await Promise.all([
    supabase
      .from("players")
      .select(
        `id, full_name, known_as, date_of_birth, nationality, position, current_team_id,
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
  ]);

  if (!player) notFound();

  const appearances = (lineupRows ?? []).filter((l) => l.fixture && PLAYED_STATUSES.has(l.fixture.status));
  const hasMatchData = appearances.length > 0;
  const starts = appearances.filter((l) => l.is_starting).length;

  const countEvents = (types: FixtureEventType[]) =>
    (eventRows ?? []).filter((e) => types.includes(e.event_type)).length;

  const goals = countEvents(["goal", "penalty_goal"]);
  const yellowCards = countEvents(["yellow_card"]);
  const redCards = countEvents(["red_card", "second_yellow_card"]);

  const displayName = player.known_as ?? player.full_name;
  const showFullNameSubtitle = Boolean(player.known_as) && player.known_as !== player.full_name;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <TrackView type="player" id={player.id} name={displayName} imageUrl={null} />
      <div className="kivo-glass-brand rounded-2xl p-6">
        <div className="flex items-center gap-4">
          <FadeIn delay={0} className="shrink-0">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white/5">
              <UserRound className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
            </div>
          </FadeIn>
          <FadeIn delay={0.05} className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold text-foreground">{displayName}</h1>
            {showFullNameSubtitle && <p className="truncate text-xs text-foreground-subtle">{player.full_name}</p>}
            {player.position && (
              <span className="mt-1 inline-block rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
                {player.position}
              </span>
            )}
          </FadeIn>
          {profile && (
            <FadeIn delay={0.1}>
              <FollowButton targetType="player" targetId={player.id} initialFollowing={isFollowing} />
            </FadeIn>
          )}
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

      <FadeIn delay={0.25} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <Activity className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
          Season stats
        </h2>
        {hasMatchData ? (
          <div className="grid grid-cols-3 gap-2 text-center sm:grid-cols-5">
            {[
              ["Apps", appearances.length],
              ["Starts", starts],
              ["Goals", goals],
              ["Yellow", yellowCards],
              ["Red", redCards],
            ].map(([label, value]) => (
              <div key={label as string} className="kivo-glass rounded-xl px-2 py-3">
                <div className="text-lg font-semibold text-foreground">{value}</div>
                <div className="text-[10px] uppercase tracking-wide text-foreground-subtle">{label}</div>
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
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <ArrowLeftRight className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
          Transfer history
        </h2>
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
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
                      {TRANSFER_TYPE_LABEL[transfer.transfer_type]}
                    </span>
                    <span className="text-[11px] text-foreground-subtle">{formatDate(transfer.transfer_date)}</span>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-foreground">{transfer.fee_text ?? "—"}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-5 text-center text-sm text-foreground-muted">
            No transfer history synced for this player yet.
            {canManageFootballData(profile?.role) && (
              <InlineSyncButton label="Sync transfers" action={triggerPlayerTransfersSync.bind(null, player.id)} />
            )}
          </div>
        )}
      </FadeIn>
    </div>
  );
}
