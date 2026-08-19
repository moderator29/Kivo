import { CircleAlert, CircleCheck, Hourglass, Receipt } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { LocalDateTime } from "@/components/ui/relative-time";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * A gameweek's score, itemised, with an honest statement of how complete it is.
 *
 * ## The two things this exists to prevent
 *
 * **A number that appears.** Before this, a manager's gameweek was one integer.
 * They could not ask why it was 47, and neither could KIVO — the scorer
 * computed every component and threw them all away. The founding directive
 * asks that every awarded point trace to verified match data; a total that
 * cannot be decomposed does not trace to anything.
 *
 * **A partial score that looks settled.** A gameweek scored while half its
 * fixtures are unplayed, or one whose finished fixtures have no synced events,
 * produces a confident-looking number that is simply short. The second case is
 * the nastier one: a finished fixture with no events yields exactly the same
 * points as a real goalless, cardless match, so a hat-trick that never synced
 * is invisible in the total. `fixtures_with_events` is the only thing that can
 * distinguish them, and it is rendered here rather than left in the row —
 * a provisional total that does not say so is the same lie in a nicer font.
 *
 * Everything below is read from real rows through the viewer's own RLS-gated
 * client. Nothing is projected, estimated or summed on the client.
 */

type BreakdownLine = {
  playerName: string;
  position: string | null;
  isStarting: boolean;
  multiplier: number;
  goals: number;
  assists: number;
  ownGoals: number;
  yellowCards: number;
  redCards: number;
  cleanSheets: number;
  appearancePoints: number;
  goalPoints: number;
  assistPoints: number;
  ownGoalPoints: number;
  cardPoints: number;
  cleanSheetPoints: number;
  totalPoints: number;
};

/** One itemised component, rendered only when it is non-zero — a row of six
 * zeroes for a player who did nothing is noise, and the appearance point plus
 * the total already say they played. */
function Component({ label, value }: { label: string; value: number }) {
  if (value === 0) return null;
  return (
    <span className="whitespace-nowrap text-[11px] text-foreground-subtle">
      {label} <span className={value > 0 ? "text-foreground-muted" : "text-warning"}>{value > 0 ? `+${value}` : value}</span>
    </span>
  );
}

export async function GameweekScorecard({
  fantasyTeamId,
  gameweekId,
  gameweekNumber,
}: {
  fantasyTeamId: string;
  gameweekId: string;
  gameweekNumber: number;
}) {
  const supabase = createServerSupabaseClient();

  const [{ data: pointsRow }, { data: breakdownRows }] = await Promise.all([
    supabase
      .from("fantasy_points")
      .select(
        "points, status, fixtures_total, fixtures_finished, fixtures_with_events, computed_at, scoring_model_version, transfer_points_cost",
      )
      .eq("fantasy_team_id", fantasyTeamId)
      .eq("gameweek_id", gameweekId)
      .maybeSingle(),
    supabase
      .from("fantasy_point_breakdowns")
      .select(
        "is_starting, multiplier, goals, assists, own_goals, yellow_cards, red_cards, clean_sheets, appearance_points, goal_points, assist_points, own_goal_points, card_points, clean_sheet_points, total_points, player:players(full_name, known_as, position)",
      )
      .eq("fantasy_team_id", fantasyTeamId)
      .eq("gameweek_id", gameweekId),
  ]);

  // An absent row means "not scored yet", never zero — the scorer only writes
  // once a gameweek has at least one finished fixture. Rendering nothing is
  // correct here: the builder above already says the gameweek is in progress,
  // and a 0 would read as a bad week rather than as an uncalculated one.
  if (!pointsRow) return null;

  const rulesetVersion = pointsRow.scoring_model_version;
  const { data: ruleset } = rulesetVersion
    ? await supabase.from("fantasy_scoring_rulesets").select("summary").eq("version", rulesetVersion).maybeSingle()
    : { data: null };

  const lines: BreakdownLine[] = (breakdownRows ?? [])
    .map((row) => ({
      playerName: row.player?.known_as ?? row.player?.full_name ?? "Unknown player",
      position: row.player?.position ?? null,
      isStarting: row.is_starting,
      multiplier: row.multiplier,
      goals: row.goals,
      assists: row.assists,
      ownGoals: row.own_goals,
      yellowCards: row.yellow_cards,
      redCards: row.red_cards,
      cleanSheets: row.clean_sheets,
      appearancePoints: row.appearance_points,
      goalPoints: row.goal_points,
      assistPoints: row.assist_points,
      ownGoalPoints: row.own_goal_points,
      cardPoints: row.card_points,
      cleanSheetPoints: row.clean_sheet_points,
      totalPoints: row.total_points,
    }))
    // Starters first, then by contribution — within the XI, the players who
    // actually decided the week belong at the top. Deliberately not the team
    // sheet order: this is a scorecard, and a scorecard is read by size.
    .sort((a, b) => {
      if (a.isStarting !== b.isStarting) return a.isStarting ? -1 : 1;
      return b.totalPoints - a.totalPoints;
    });

  const isFinal = pointsRow.status === "final";
  const finished = pointsRow.fixtures_finished;
  const total = pointsRow.fixtures_total;
  const withEvents = pointsRow.fixtures_with_events;
  const missingEvents = finished !== null && withEvents !== null ? finished - withEvents : null;

  // The identity that makes this an audit trail rather than a decoration: the
  // itemised lines must sum to the stored total. If they ever do not, the
  // discrepancy is shown rather than hidden — a breakdown that silently
  // disagrees with the score is worse than no breakdown.
  const transferCost = pointsRow.transfer_points_cost ?? 0;
  const lineSum = lines.reduce((sum, line) => sum + line.totalPoints, 0);
  const reconciles = lines.length === 0 || lineSum + transferCost === pointsRow.points;

  return (
    <FadeIn className="kivo-glass mx-auto flex w-full max-w-2xl flex-col gap-4 rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
            <Receipt className="h-4 w-4 text-accent" strokeWidth={1.75} />
            Gameweek {gameweekNumber} scorecard
          </h2>
          {pointsRow.computed_at && (
            <span className="text-[11px] text-foreground-subtle">
              Calculated <LocalDateTime iso={pointsRow.computed_at} format="dayTime" />
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-2xl font-semibold tabular-nums text-foreground">{pointsRow.points}</span>
          <span
            className={`flex items-center gap-1 text-[11px] font-semibold ${isFinal ? "text-live" : "text-foreground-subtle"}`}
          >
            {isFinal ? (
              <CircleCheck className="h-3.5 w-3.5" strokeWidth={2} />
            ) : (
              <Hourglass className="h-3.5 w-3.5" strokeWidth={2} />
            )}
            {isFinal ? "Final" : "Provisional"}
          </span>
        </div>
      </div>

      {/* Why it is provisional, in specifics. "Provisional" on its own is a
          shrug; the counts are what let a manager judge whether to argue. */}
      {!isFinal && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-hairline bg-surface-1 p-3">
          {finished !== null && total !== null && finished < total && (
            <span className="text-[11px] leading-relaxed text-foreground-subtle">
              {finished} of {total} matches in this gameweek have finished. This total will move as the rest are
              played.
            </span>
          )}
          {missingEvents !== null && missingEvents > 0 && (
            <span className="flex items-start gap-1.5 text-[11px] leading-relaxed text-warning">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              {missingEvents} finished {missingEvents === 1 ? "match has" : "matches have"} no goals or cards on
              record. That is either a genuinely quiet {missingEvents === 1 ? "match" : "set of matches"} or detail
              KIVO doesn&apos;t have yet, so this total may be short by whatever happened in{" "}
              {missingEvents === 1 ? "it" : "them"}.
            </span>
          )}
          {finished !== null && total !== null && finished === total && missingEvents === 0 && (
            <span className="text-[11px] leading-relaxed text-foreground-subtle">
              This gameweek was scored before KIVO recorded how complete a score was, so it stays provisional.
            </span>
          )}
        </div>
      )}

      {/* The transfer hit as a visible line rather than four points silently
          missing from the total. A manager who took a hit knew they were taking
          it; a manager who cannot see it just thinks the maths is wrong. */}
      {transferCost !== 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-surface-1 px-3 py-2">
          <span className="text-[11px] text-foreground-muted">Transfer cost</span>
          <span className="text-sm font-semibold tabular-nums text-warning">{transferCost}</span>
        </div>
      )}

      {!reconciles && (
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-warning">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          The breakdown below adds up to {lineSum + transferCost}, not {pointsRow.points}. Something is wrong with this
          score — please report it rather than trusting either number.
        </p>
      )}

      {lines.length > 0 ? (
        <ul className="flex flex-col divide-y divide-hairline-soft">
          {lines.map((line) => (
            <li key={line.playerName} className="flex items-start justify-between gap-3 py-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-1.5 truncate text-sm text-foreground">
                  {line.playerName}
                  {line.multiplier > 1 && (
                    <span className="rounded-full border border-accent-hairline bg-accent-soft px-1.5 text-[10px] font-semibold text-foreground">
                      ×{line.multiplier}
                    </span>
                  )}
                  {!line.isStarting && <span className="text-[10px] text-foreground-subtle">bench</span>}
                </span>
                <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
                  {line.isStarting ? (
                    <>
                      <Component label="Played" value={line.appearancePoints} />
                      <Component label={`${line.goals} goal${line.goals === 1 ? "" : "s"}`} value={line.goalPoints} />
                      <Component
                        label={`${line.assists} assist${line.assists === 1 ? "" : "s"}`}
                        value={line.assistPoints}
                      />
                      <Component label="Clean sheet" value={line.cleanSheetPoints} />
                      <Component label="Cards" value={line.cardPoints} />
                      <Component label="Own goal" value={line.ownGoalPoints} />
                    </>
                  ) : (
                    <span className="text-[11px] text-foreground-subtle">
                      On your bench — bench players score nothing.
                    </span>
                  )}
                </div>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{line.totalPoints}</span>
            </li>
          ))}
        </ul>
      ) : (
        // computed_at null is the unambiguous marker of a row written before
        // KIVO itemised points. Saying so is a different sentence from an empty
        // breakdown, and only one of them is true — there is nothing real to
        // back-fill from, so nothing is back-filled.
        <p className="text-[11px] leading-relaxed text-foreground-subtle">
          {pointsRow.computed_at === null
            ? "This gameweek was scored before KIVO started itemising points, so there's no player-by-player breakdown for it. Future gameweeks will show one."
            : "No player-by-player breakdown was recorded for this gameweek."}
        </p>
      )}

      {ruleset?.summary && ruleset.summary.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
            Rules used for this gameweek{rulesetVersion ? ` (v${rulesetVersion})` : ""}
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {/* The rules AS THEY STOOD for the version stamped on this row, not
                today's — which is the entire reason the ruleset is stored per
                version rather than read from the current constants. */}
            {ruleset.summary.map((rule) => (
              <li key={rule} className="text-[11px] leading-relaxed text-foreground-subtle">
                {rule}
              </li>
            ))}
          </ul>
        </details>
      )}
    </FadeIn>
  );
}
