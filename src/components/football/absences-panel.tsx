import Link from "next/link";
import { CircleAlert, CircleHelp, HeartPulse } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { LocalDateTime } from "@/components/ui/relative-time";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getActiveProviderStatus } from "@/lib/football";
import { getCompetitionCapability } from "@/lib/football/coverage-registry";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { InlineSyncButton } from "@/components/admin/inline-sync-button";
import { triggerInjuriesSync } from "@/app/admin/data-health/provider-data-actions";

/**
 * Reported absences for one club.
 *
 * ## Why this panel is written more carefully than a stats card
 *
 * Every row is a claim about a named person's fitness. Getting a possession
 * percentage wrong is embarrassing; telling a fan a player is ruled out when
 * they are fit is a different category of wrong, and it is the kind of thing
 * that gets screenshotted. So:
 *
 *   * a report whose status KIVO could not parse renders as "status unclear",
 *     not as "out" — the provider's own word is shown instead of a KIVO
 *     interpretation of it;
 *   * the reason is the provider's free text, verbatim;
 *   * there is no return date anywhere, because the provider publishes none;
 *   * every row is dated, so a stale report reads as a stale report.
 *
 * ## The empty state distinguishes three things
 *
 * "No absences reported" and "KIVO has never synced absences" and "this data
 * source does not publish absences for this competition" are three different
 * facts, and only the first is about the football team. The coverage registry
 * (migration 0082) is what makes the third one sayable at all.
 */

const STATUS_STYLE = {
  out: { label: "Out", className: "text-warning", icon: CircleAlert },
  doubtful: { label: "Doubtful", className: "text-foreground-muted", icon: CircleHelp },
  unknown: { label: "Status unclear", className: "text-foreground-subtle", icon: CircleHelp },
} as const;

type AbsenceStatus = keyof typeof STATUS_STYLE;

export async function TeamAbsencesPanel({ teamId, teamName }: { teamId: string; teamName: string }) {
  const supabase = createServerSupabaseClient();
  const { name: providerName, label: providerLabel } = getActiveProviderStatus();

  const [{ data: rows }, { data: latestFixture }] = await Promise.all([
    supabase
      .from("injuries")
      .select("id, status, reason, reported_on, competition_id, player:players(id, full_name, known_as, photo_url, position)")
      .eq("team_id", teamId)
      // Newest first so the per-player dedupe below keeps the current report
      // rather than whichever one the database happened to return first.
      .order("reported_on", { ascending: false, nullsFirst: false })
      .order("updated_at", { ascending: false })
      .limit(60),
    // A club has no single competition, so the coverage question is asked about
    // the competition it most recently played in — the one a reader looking at
    // this page is almost certainly thinking of.
    supabase
      .from("fixtures")
      .select("competition_id, season:seasons(provider_year)")
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .order("kickoff_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // One row per player: an injuries feed reports the same absence against every
  // upcoming fixture, so an undeduped list shows the same player five times and
  // reads as five separate problems.
  const byPlayer = new Map<string, NonNullable<typeof rows>[number]>();
  for (const row of rows ?? []) {
    if (!row.player) continue;
    if (!byPlayer.has(row.player.id)) byPlayer.set(row.player.id, row);
  }
  const absences = Array.from(byPlayer.values());

  const verdict =
    absences.length === 0 && providerName && latestFixture?.competition_id
      ? await getCompetitionCapability(
          supabase,
          providerName,
          latestFixture.competition_id,
          "injuries",
          latestFixture.season?.provider_year ?? undefined,
        )
      : null;

  // Absences are fetched per COMPETITION, not per club, so the sync offered
  // here is the competition this club most recently played in — stated on the
  // button's hint rather than left to look like a club-scoped action.
  const profile = await getOrCreateProfile();
  const canSync =
    profile !== null &&
    canManageFootballData(profile.role) &&
    latestFixture?.competition_id != null &&
    verdict !== "unsupported";

  return (
    <FadeIn delay={0.22} className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
        <HeartPulse className="h-4 w-4 text-accent" strokeWidth={1.75} />
        Reported absences
      </h2>

      {absences.length > 0 ? (
        <>
          <ul className="flex flex-col divide-y divide-hairline-soft">
            {absences.map((row) => {
              const player = row.player!;
              const style = STATUS_STYLE[(row.status as AbsenceStatus) in STATUS_STYLE ? (row.status as AbsenceStatus) : "unknown"];
              const Icon = style.icon;
              return (
                <li key={row.id} className="flex items-center gap-3 py-2.5">
                  <PlayerAvatar photoUrl={player.photo_url} name={player.known_as ?? player.full_name} size={32} />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <Link
                      href={`/players/${player.id}`}
                      className="truncate text-sm text-foreground hover:text-accent"
                    >
                      {player.known_as ?? player.full_name}
                    </Link>
                    <span className="truncate text-[11px] text-foreground-subtle">
                      {/* The provider's own words. Never re-phrased, never
                          bucketed into a KIVO category. */}
                      {row.reason ?? "No reason given"}
                      {row.reported_on && (
                        <>
                          {" · "}
                          <LocalDateTime iso={`${row.reported_on}T12:00:00Z`} format="dayTime" />
                        </>
                      )}
                    </span>
                  </div>
                  <span className={`flex shrink-0 items-center gap-1 text-[11px] font-semibold ${style.className}`}>
                    <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                    {style.label}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] leading-relaxed text-foreground-subtle">
            As reported by {providerLabel ?? "the connected data source"}. KIVO doesn&apos;t estimate return dates —
            no data source publishes one.
          </p>
        </>
      ) : (
        <p className="text-sm text-foreground-muted">
          {verdict === "unsupported"
            ? `${providerLabel ?? "The current data source"} doesn't publish absence reports for ${teamName}'s competition, so this section can't fill.`
            : verdict === "supported"
              ? `No absences have been synced for ${teamName} yet.`
              : `No absences synced for ${teamName}, and KIVO hasn't established whether ${providerLabel ?? "the current data source"} publishes them for this competition.`}
        </p>
      )}

      {canSync && latestFixture?.competition_id && (
        <InlineSyncButton
          label="Sync absences"
          action={triggerInjuriesSync.bind(null, latestFixture.competition_id, undefined)}
          hint="Pulls the whole competition's absence list, not just this club's."
        />
      )}
    </FadeIn>
  );
}

/**
 * The same fact, for one player, as a single line.
 *
 * Rendered as nothing at all when there is no current report — an "available"
 * badge would be a fitness claim KIVO cannot make, since the absence of a
 * report is not evidence of fitness.
 */
export async function PlayerAbsenceNote({ playerId }: { playerId: string }) {
  const supabase = createServerSupabaseClient();
  const { label: providerLabel } = getActiveProviderStatus();

  const { data: row } = await supabase
    .from("injuries")
    .select("status, reason, reported_on")
    .eq("player_id", playerId)
    .order("reported_on", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) return null;

  const style = STATUS_STYLE[(row.status as AbsenceStatus) in STATUS_STYLE ? (row.status as AbsenceStatus) : "unknown"];
  const Icon = style.icon;

  return (
    <div className="kivo-glass flex items-start gap-2.5 rounded-2xl p-4">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.className}`} strokeWidth={1.75} />
      <div className="flex flex-col gap-0.5">
        <span className={`text-sm font-medium ${style.className}`}>{style.label}</span>
        <span className="text-[11px] leading-relaxed text-foreground-subtle">
          {row.reason ?? "No reason given"}
          {row.reported_on && (
            <>
              {" · reported "}
              <LocalDateTime iso={`${row.reported_on}T12:00:00Z`} format="dayTime" />
            </>
          )}
          {" · "}
          {providerLabel ?? "connected data source"}
        </span>
      </div>
    </div>
  );
}
