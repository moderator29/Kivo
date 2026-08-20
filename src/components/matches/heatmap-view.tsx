"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { CircleAlert, Radar, RefreshCw } from "lucide-react";
import { PitchLines } from "@/app/(app)/fantasy/pitch";
import { PITCH_DIMENSIONS } from "@/lib/football/heatmap-engine";
import type { PitchOrientation } from "@/lib/football/heatmap/pitch-coordinates";
import { buildPlayerHeatmap, type FixtureHeatmapSet, type PlayerHeatmapSubject } from "@/lib/football/heatmap/fixture-heatmap";
import type { AggregatedHeatmap } from "@/lib/football/heatmap/heatmap-aggregator";
import type { MatchPeriod, PitchActionClass } from "@/lib/football/heatmap/event-normalizer";
import { loadFixtureHeatmaps } from "@/app/(app)/matches/heatmap-actions";

/**
 * KIVO's heatmap surface.
 *
 * ## The one thing this component may never do
 *
 * Render a shape without saying what the shape is. Every grid it draws carries
 * a `derivation` field on the same object, and the caption is generated from
 * that field rather than written as static copy — so there is no code path in
 * which a heatmap appears without the sentence explaining what it was built
 * from. Today that sentence always says the shape is derived from where players
 * lined up and what the match record contains, because no positional-tracking
 * provider is connected to KIVO and API-Football publishes no pitch coordinates
 * on any plan.
 *
 * That is the founder's point 4, enforced structurally rather than by
 * remembering to write it.
 *
 * ## Two layers of data, and the second can only improve on the first
 *
 * The `heatmaps` prop is built by Match Centre from lineups and events it
 * already holds — so this component has something real to draw on first paint,
 * with no request and no spinner. It then asks the server for a richer version
 * that can see the provider's formation-slot `grid` and per-player match
 * statistics. If that fails, is unavailable, or has nothing, the baseline
 * stands. The upgrade can sharpen a shape; it can never empty one.
 */

export type FixtureHeatmapViewProps = {
  /** Built by `buildFixtureHeatmaps` — the same object the caller gated the tab
   * on with `hasFixtureHeatmapContent`, so availability and content cannot
   * disagree. */
  heatmaps: FixtureHeatmapSet;
  homeTeamName: string;
  awayTeamName: string;
};

export type HeatmapViewProps = FixtureHeatmapViewProps;

/** Server-enriched grids, tagged with the fixture and period they answer for. */
type LoadedHeatmaps = {
  key: string;
  heatmaps: Record<string, AggregatedHeatmap>;
  usedPlayerStatistics: boolean;
};

type PeriodChoice = MatchPeriod | "full-match";

const PERIOD_LABEL: Record<PeriodChoice, string> = {
  "full-match": "Full match",
  "first-half": "First half",
  "second-half": "Second half",
  "extra-time": "Extra time",
};

const ACTION_CLASS_LABEL: Record<PitchActionClass, string> = {
  goalkeeping: "goalkeeping",
  defensive: "defensive actions",
  buildUp: "passing",
  attacking: "attacking actions",
  discipline: "fouls and cards",
  unclassified: "other involvement",
};

/**
 * The heat ramp, low to high.
 *
 * Fixed hex rather than theme tokens on purpose: a density ramp has to keep the
 * same ordering in light and dark, and a token that inverts between themes would
 * flip which end of the scale reads as "busy". These are KIVO's own palette
 * values (`--kivo-blue` through `--kivo-magenta`), so it stays in family without
 * being at the mercy of a theme swap.
 */
const HEAT_STOPS = [
  { at: 0.0, color: "#2563ff", opacity: 0 },
  { at: 0.25, color: "#2563ff", opacity: 0.32 },
  { at: 0.5, color: "#00d9ff", opacity: 0.5 },
  { at: 0.75, color: "#7c3fff", opacity: 0.62 },
  { at: 1.0, color: "#d946ef", opacity: 0.75 },
] as const;

function heatFor(density: number): { color: string; opacity: number } {
  if (density <= 0) return { color: HEAT_STOPS[0].color, opacity: 0 };
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const lower = HEAT_STOPS[i - 1];
    const upper = HEAT_STOPS[i];
    if (density <= upper.at) {
      const span = upper.at - lower.at;
      const t = span === 0 ? 0 : (density - lower.at) / span;
      // Colour snaps to the nearer stop while opacity interpolates. Blending two
      // hex colours per cell would need a colour space to be correct in, and the
      // blur below smooths the boundary anyway — so the cheap version is also
      // the one that looks right.
      return { color: t < 0.5 ? lower.color : upper.color, opacity: lower.opacity + (upper.opacity - lower.opacity) * t };
    }
  }
  const last = HEAT_STOPS[HEAT_STOPS.length - 1];
  return { color: last.color, opacity: last.opacity };
}

/**
 * The sentence under the pitch, generated from the grid rather than written
 * alongside it.
 *
 * Deliberately says "where they lined up and what the match record shows"
 * before it says anything about the player, because the reader's first question
 * on seeing a heatmap is whether it is tracking data — and the honest answer
 * has to arrive before the shape is interpreted, not after.
 */
function basisSentence(
  heatmap: AggregatedHeatmap,
  subject: PlayerHeatmapSubject,
  usedPlayerStatistics: boolean,
): string {
  if (heatmap.derivation === "tracked") {
    return `Built from ${heatmap.totalActions.toLocaleString("en-GB")} recorded on-pitch positions.`;
  }

  const anchorBasis = subject.anchor?.basis ?? "no positional basis";
  const top = heatmap.classMix
    .filter((entry) => entry.actionClass !== "unclassified")
    .slice(0, 2)
    .map((entry) => ACTION_CLASS_LABEL[entry.actionClass]);

  const source = usedPlayerStatistics
    ? "their recorded match involvement"
    : "the goals, cards and substitutions on record";

  const shapedBy = top.length > 0 ? ` Weighted towards ${top.join(" and ")}.` : "";

  return `Not tracking data. This shape is inferred from ${anchorBasis} and ${source} — ${heatmap.totalActions.toLocaleString("en-GB")} recorded ${heatmap.totalActions === 1 ? "action" : "actions"}.${shapedBy}`;
}

export function HeatmapView({ heatmaps, homeTeamName, awayTeamName }: HeatmapViewProps) {
  const gradientId = useId();
  const blurId = useId();

  const [side, setSide] = useState<"home" | "away">("home");
  const [period, setPeriod] = useState<PeriodChoice>("full-match");
  const [orientation, setOrientation] = useState<PitchOrientation>("attacking");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  /**
   * The server-enriched grids, tagged with the request they answer.
   *
   * Keyed rather than cleared-and-refilled so that switching period cannot show
   * one period's shapes under another period's heading for a frame — the key
   * mismatch makes stale data unreadable rather than merely old. It also keeps
   * every piece of derived state below a pure function of props and this one
   * value, with no effect needed to keep them consistent.
   */
  const [loaded, setLoaded] = useState<LoadedHeatmaps | null>(null);
  const [settled, setSettled] = useState<{ key: string; outcome: "unavailable" | "failed" } | null>(null);
  const settledKey = settled?.key ?? null;
  const settledOutcome = settled?.outcome ?? null;

  const team = side === "home" ? heatmaps.home : heatmaps.away;
  const teamName = side === "home" ? homeTeamName : awayTeamName;

  const drawable = useMemo(() => team.players.filter((player) => player.anchor !== null), [team.players]);
  const undrawable = useMemo(() => team.players.filter((player) => player.anchor === null), [team.players]);

  // The selection follows the data rather than the other way round: switching
  // side, or a server upgrade changing who is drawable, must never leave a
  // player id selected that this team does not have.
  const subject =
    drawable.find((player) => player.playerId === selectedPlayerId) ?? drawable[0] ?? null;

  const periods: PeriodChoice[] = useMemo(
    () => ["full-match", ...heatmaps.periodsPresent],
    [heatmaps.periodsPresent],
  );

  // A period the fixture does not have would render an empty pitch under a chip
  // the reader just pressed. Derived rather than corrected in an effect: an
  // effect would let the invalid state render once first, and there is nothing
  // to synchronize here — this is just arithmetic on props.
  const activePeriod: PeriodChoice = periods.includes(period) ? period : "full-match";

  const requestKey = `${heatmaps.fixtureId}:${activePeriod}`;
  const enriched = loaded?.key === requestKey ? loaded.heatmaps : null;
  const usedPlayerStatistics = loaded?.key === requestKey ? loaded.usedPlayerStatistics : false;

  // Four states, not three. "There is no richer version to fetch" is the
  // ordinary path — a fixture KIVO does not hold, a signed-out reader — and it
  // must not tell anybody something went wrong, because nothing did. Only a
  // genuine failure earns a line of explanation.
  const loadState: "idle" | "loading" | "unavailable" | "failed" =
    enriched !== null ? "idle" : (settledKey === requestKey ? (settledOutcome ?? "unavailable") : "loading");

  useEffect(() => {
    let cancelled = false;
    loadFixtureHeatmaps(heatmaps.fixtureId, activePeriod)
      .then((result) => {
        if (cancelled) return;
        if (result.status === "ok") {
          setLoaded({
            key: requestKey,
            heatmaps: result.heatmaps,
            usedPlayerStatistics: result.usedPlayerStatistics,
          });
          return;
        }
        setSettled({ key: requestKey, outcome: result.status === "error" ? "failed" : "unavailable" });
      })
      .catch(() => {
        // A rejected action is a genuine failure — a network drop, a server
        // error — as distinct from the action itself reporting that there is
        // nothing to fetch.
        if (!cancelled) setSettled({ key: requestKey, outcome: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey, heatmaps.fixtureId, activePeriod]);

  const heatmap = useMemo(() => {
    if (!subject) return null;
    return enriched?.[subject.playerId] ?? buildPlayerHeatmap(subject, { period: activePeriod });
  }, [subject, enriched, activePeriod]);

  if (drawable.length === 0 && undrawable.length === 0) {
    return <HeatmapEmptyState reason="nothing-recorded" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="kivo-glass flex flex-col gap-4 rounded-2xl p-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">Player heatmap</h3>
            {loadState === "loading" && (
              <span className="flex items-center gap-1.5 text-[11px] text-foreground-subtle">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                Refining
              </span>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-foreground-subtle">
            KIVO doesn&apos;t have tracking data for this match. These shapes are built from where each player lined
            up and what the match record contains — read them as a picture of a role, not of movement.
          </p>
        </div>

        <SegmentedControl
          label="Team"
          options={[
            { value: "home", label: homeTeamName },
            { value: "away", label: awayTeamName },
          ]}
          value={side}
          onChange={(value) => {
            setSide(value);
            setSelectedPlayerId(null);
          }}
        />

        {drawable.length > 0 ? (
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
              {teamName} {team.formation ? `· ${team.formation}` : ""}
            </span>
            {/* Two behaviours, because the right one differs by width.
                On a phone a full XI cannot wrap without becoming three ragged
                rows that destroy the team-sheet order, so it scrolls — with a
                fade at the trailing edge, because a row that simply stops at the
                card's edge mid-name reads as broken rather than as scrollable.
                From `sm:` up there is room to wrap, so it wraps and nothing is
                hidden at all; the mask is switched off there so it cannot fade
                a chip that is fully visible. */}
            <div className="relative">
              <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [mask-image:linear-gradient(to_right,transparent_0,black_10px,black_calc(100%-28px),transparent_100%)] [scrollbar-width:none] sm:flex-wrap sm:overflow-x-visible sm:[mask-image:none] [&::-webkit-scrollbar]:hidden">
              {drawable.map((player) => {
                const active = subject?.playerId === player.playerId;
                return (
                  <button
                    key={player.playerId}
                    type="button"
                    onClick={() => setSelectedPlayerId(player.playerId)}
                    aria-pressed={active}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? "border-accent-hairline bg-accent-soft text-foreground"
                        : "border-hairline bg-surface-1 text-foreground-muted hover:text-foreground"
                    }`}
                  >
                    {player.shirtNumber !== null && (
                      <span className="mr-1.5 tabular-nums text-foreground-subtle">{player.shirtNumber}</span>
                    )}
                    {player.playerName}
                    {!player.isStarting && <span className="ml-1.5 text-[10px] text-foreground-subtle">sub</span>}
                  </button>
                );
              })}
              </div>
              {/* Named, not just faded. A gradient alone tells you something is
                  cut off; it does not tell you how much. */}
              <p className="mt-1 text-[11px] text-foreground-subtle sm:hidden">
                {drawable.length} players · scroll for more
              </p>
            </div>
          </div>
        ) : (
          <HeatmapEmptyState reason="no-positions" teamName={teamName} />
        )}

        {drawable.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <SegmentedControl
              label="Period"
              options={periods.map((value) => ({ value, label: PERIOD_LABEL[value] }))}
              value={activePeriod}
              onChange={setPeriod}
            />
            <SegmentedControl
              label="Direction"
              options={[
                { value: "attacking" as const, label: "Attacking up" },
                { value: "defensive" as const, label: "Defending up" },
              ]}
              value={orientation}
              onChange={setOrientation}
            />
          </div>
        )}
      </div>

      {subject && heatmap && (
        <div className="kivo-glass relative flex flex-col gap-3 overflow-hidden rounded-2xl p-4">
          <PitchLines />

          <div className="relative flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold text-foreground">{subject.playerName}</span>
            <span className="text-[11px] uppercase tracking-wide text-foreground-subtle">
              {PERIOD_LABEL[activePeriod]}
            </span>
          </div>

          {heatmap.hasData ? (
            // A 100x140 pitch drawn at full container width is over a
            // thousand pixels tall on a desktop, which pushes the caption that
            // qualifies it below the fold — and a disclaimer only does its job
            // if it is on screen at the same time as the thing it disclaims.
            // Capped and centred, so picture and caption are read together at
            // every width.
            <svg
              className="relative mx-auto w-full max-w-[min(100%,340px)]"
              viewBox={`0 0 ${PITCH_DIMENSIONS.width} ${PITCH_DIMENSIONS.height}`}
              preserveAspectRatio="xMidYMid meet"
              style={{ aspectRatio: `${PITCH_DIMENSIONS.width} / ${PITCH_DIMENSIONS.height}` }}
              role="img"
              aria-label={`Derived activity heatmap for ${subject.playerName}, ${PERIOD_LABEL[activePeriod].toLowerCase()}`}
            >
              <defs>
                {/* The "smooth" in a smooth heatmap. Zone rectangles are the
                    honest unit of the data — the engine genuinely knows a zone,
                    not a point — so they are what is drawn, and a Gaussian blur
                    over the top removes the grid artefact without inventing
                    resolution the data does not have. */}
                <filter id={blurId} x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="7" />
                </filter>
                <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
                  {HEAT_STOPS.map((stop) => (
                    <stop key={stop.at} offset={stop.at} stopColor={stop.color} stopOpacity={stop.opacity} />
                  ))}
                </linearGradient>
              </defs>

              <g filter={`url(#${blurId})`}>
                {heatmap.grid.zones.map((zone) => {
                  const heat = heatFor(zone.density);
                  if (heat.opacity <= 0.01) return null;
                  const cellWidth = PITCH_DIMENSIONS.width / heatmap.grid.cols;
                  const cellHeight = PITCH_DIMENSIONS.height / heatmap.grid.rows;
                  // Canonical row 0 is the deepest band; render y grows
                  // downwards and KIVO draws attack at the top, so the row index
                  // is flipped here. `defensive` orientation flips it back.
                  const rowFromTop =
                    orientation === "attacking" ? heatmap.grid.rows - 1 - zone.row : zone.row;
                  return (
                    <rect
                      key={`${zone.col}-${zone.row}`}
                      x={zone.col * cellWidth}
                      y={rowFromTop * cellHeight}
                      width={cellWidth}
                      height={cellHeight}
                      fill={heat.color}
                      fillOpacity={heat.opacity}
                    />
                  );
                })}
              </g>

              {/* The direction of play, stated on the graphic itself. A heatmap
                  with no arrow is ambiguous by exactly 180 degrees. */}
              <g className="text-foreground-subtle" opacity="0.5">
                <line
                  x1={PITCH_DIMENSIONS.width - 6}
                  y1={orientation === "attacking" ? 26 : PITCH_DIMENSIONS.height - 26}
                  x2={PITCH_DIMENSIONS.width - 6}
                  y2={orientation === "attacking" ? 8 : PITCH_DIMENSIONS.height - 8}
                  stroke="currentColor"
                  strokeWidth="1"
                />
                <polygon
                  points={
                    orientation === "attacking"
                      ? `${PITCH_DIMENSIONS.width - 6},4 ${PITCH_DIMENSIONS.width - 9},10 ${PITCH_DIMENSIONS.width - 3},10`
                      : `${PITCH_DIMENSIONS.width - 6},${PITCH_DIMENSIONS.height - 4} ${PITCH_DIMENSIONS.width - 9},${PITCH_DIMENSIONS.height - 10} ${PITCH_DIMENSIONS.width - 3},${PITCH_DIMENSIONS.height - 10}`
                  }
                  fill="currentColor"
                />
              </g>
            </svg>
          ) : (
            <div className="relative rounded-xl border border-hairline bg-surface-1 p-6 text-center">
              <p className="text-sm text-foreground">Nothing recorded for {subject.playerName} in this period</p>
              <p className="mt-1 text-xs text-foreground-subtle">
                {heatmap.actionsWithoutPeriod > 0
                  ? `${heatmap.actionsWithoutPeriod.toLocaleString("en-GB")} recorded actions for this player carry no half, only a match total — so they can only be shown under Full match.`
                  : "Switch period, or pick another player."}
              </p>
            </div>
          )}

          <div className="relative flex flex-col gap-1.5">
            <p className="text-[11px] leading-relaxed text-foreground-subtle">
              {basisSentence(heatmap, subject, usedPlayerStatistics)}
            </p>

            {subject.anchor?.lateralConfidence === "provider-order" && (
              <p className="text-[11px] leading-relaxed text-foreground-subtle">
                Left and right are not confirmed for this data source, so the shape is spread across the width rather
                than committed to a flank.
              </p>
            )}

            {heatmap.derivation === "derived" && activePeriod !== "full-match" && heatmap.actionsWithoutPeriod > 0 && (
              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-warning">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                {heatmap.actionsWithoutPeriod.toLocaleString("en-GB")} recorded actions are match totals with no half
                attached and are excluded from this view. Full match shows all of them.
              </p>
            )}

            {loadState === "failed" && (
              <p className="text-[11px] leading-relaxed text-foreground-subtle">
                Showing the shape KIVO could build from this page&apos;s own data — a more detailed version
                couldn&apos;t be loaded just now.
              </p>
            )}
          </div>
        </div>
      )}

      {undrawable.length > 0 && (
        <p className="text-[11px] leading-relaxed text-foreground-subtle">
          {undrawable.length} {undrawable.length === 1 ? "player is" : "players are"} not shown: KIVO has no recorded
          position for {undrawable.length === 1 ? "them" : "them"} in this match. Substitutes have no place on a team
          sheet, and drawing one as though they held a position for ninety minutes would be inventing it.
        </p>
      )}
    </div>
  );
}

function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">{label}</span>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={active}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? "border-accent-hairline bg-accent-soft text-foreground"
                  : "border-hairline bg-surface-1 text-foreground-muted hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The two genuinely-empty states, kept apart because they mean different things
 * and ask the reader to do different things.
 */
function HeatmapEmptyState({ reason, teamName }: { reason: "nothing-recorded" | "no-positions"; teamName?: string }) {
  return (
    <div className="kivo-glass relative flex flex-col items-center gap-3 overflow-hidden rounded-2xl p-8 text-center">
      <PitchLines />
      <div className="relative flex h-12 w-12 items-center justify-center rounded-full border border-hairline bg-surface-1">
        <Radar className="h-6 w-6 text-foreground-subtle" strokeWidth={1.75} />
      </div>
      <div className="relative flex flex-col gap-1.5">
        {reason === "nothing-recorded" ? (
          <>
            <p className="text-sm font-medium text-foreground">No lineup for this match yet</p>
            <p className="max-w-xs text-xs leading-relaxed text-foreground-subtle">
              A heatmap starts from who played and where they lined up. Once the lineup lands, this fills in on its
              own.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-foreground">No recorded positions for {teamName ?? "this team"}</p>
            <p className="max-w-xs text-xs leading-relaxed text-foreground-subtle">
              KIVO has this team&apos;s lineup but not the positions its players lined up in, so there is nothing
              honest to place on a pitch. The other side may still have them.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
