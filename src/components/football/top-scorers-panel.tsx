import Link from "next/link";
import { Goal } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { TeamCrest } from "@/components/ui/team-crest";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * A competition's scoring chart.
 *
 * ## Rank is the provider's, and is rendered as given
 *
 * Rows are ordered by the stored `rank` rather than by goals. Competitions
 * break ties differently — goals, then assists, then minutes, in most leagues,
 * but not all of them and not always in that order — and the provider applies
 * the competition's own rules. Re-sorting here would substitute a different
 * competition's tie-breaks for this one's, and a reader would have no way to
 * tell.
 *
 * ## The empty state names which of three things it is
 *
 * "Nobody has scored" is not one of them, and the panel never implies it. An
 * empty chart is either unsynced, unsupported by the data source for this
 * competition, or unestablished — and the coverage registry is what makes the
 * middle one sayable.
 *
 * ## The sync control that used to live here is in Admin
 *
 * ADMIN IA PASS 2026-08-19. This panel carried a role-gated "Sync scoring
 * chart" button. The gating was correct; the placement was not. A fan reading a
 * league table should not share the page with ingestion controls, and a founder
 * reviewing his own product could not tell which half of the screen the public
 * sees. The button now lives on /admin/data-health/coverage, per competition,
 * with its provider cost stated before it is pressed — which the inline version
 * never did. Nothing a fan could see has been removed: the chart, the ordering
 * and the one-line empty state are unchanged.
 */
const TOP_SCORER_LIMIT = 10;

export async function TopScorersPanel({
  seasonId,
  seasonLabel,
}: {
  /** Null when no current season is set — there is then nothing to chart, and
   * the panel says exactly that rather than showing last season's. */
  seasonId: string | null;
  seasonLabel: string | null;
}) {
  const supabase = createServerSupabaseClient();

  const { data: rows } = seasonId
    ? await supabase
        .from("top_scorers")
        .select(
          "id, rank, goals, assists, penalties_scored, appearances, minutes_played, player:players(id, full_name, known_as, photo_url), team:teams(id, name, crest_url)",
        )
        .eq("season_id", seasonId)
        .order("rank", { ascending: true })
        .limit(TOP_SCORER_LIMIT)
    : { data: null };

  const scorers = rows ?? [];

  return (
    <FadeIn delay={0.18} className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <Goal className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Top scorers
        </h2>
        {seasonLabel && <span className="text-[11px] text-foreground-subtle">{seasonLabel}</span>}
      </div>

      {scorers.length > 0 ? (
        <ul className="flex flex-col divide-y divide-hairline-soft">
          {scorers.map((row) => (
            <li key={row.id} className="flex items-center gap-3 py-2.5">
              <span className="w-5 shrink-0 text-right text-xs font-semibold tabular-nums text-foreground-subtle">
                {row.rank}
              </span>
              {row.player && (
                <PlayerAvatar
                  photoUrl={row.player.photo_url}
                  name={row.player.known_as ?? row.player.full_name}
                  size={32}
                />
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                {row.player ? (
                  <Link href={`/players/${row.player.id}`} className="truncate text-sm text-foreground hover:text-accent">
                    {row.player.known_as ?? row.player.full_name}
                  </Link>
                ) : (
                  <span className="truncate text-sm text-foreground">Unknown player</span>
                )}
                <span className="flex items-center gap-1.5 truncate text-[11px] text-foreground-subtle">
                  {row.team && <TeamCrest crestUrl={row.team.crest_url} name={row.team.name} size={12} />}
                  {row.team?.name ?? "Club not listed"}
                  {/* Only stated when the provider actually reported it. A
                      missing appearance count is left out rather than shown as
                      zero, which would read as "never played". */}
                  {row.appearances !== null && ` · ${row.appearances} apps`}
                </span>
              </div>
              <div className="flex shrink-0 items-baseline gap-1">
                <span className="text-base font-semibold tabular-nums text-foreground">{row.goals ?? "-"}</span>
                <span className="text-[11px] text-foreground-subtle">
                  {row.goals === 1 ? "goal" : "goals"}
                  {/* Penalties are broken out because "18 goals, 7 of them
                      penalties" and "18 goals" are different achievements, and
                      the provider reports the split. */}
                  {row.penalties_scored ? ` · ${row.penalties_scored} pen` : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        // FRONTEND SWEEP: a fan gets one sentence. The three-way verdict split
        // (unsupported / supported / unknown) is a fact about KIVO's coverage
        // registry, not about football, and printing it made every quiet section
        // read as a system report. That distinction still exists — it is what
        // Admin's own coverage panel is built on — but it is not football, so it
        // is not here.
        <p className="text-sm text-foreground-muted">No scoring chart for this competition yet.</p>
      )}
    </FadeIn>
  );
}
