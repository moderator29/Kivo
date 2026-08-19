import Link from "next/link";
import { TeamCrest } from "@/components/ui/team-crest";

/**
 * A real league table.
 *
 * The club page used to show one number — this club's position — and nothing
 * around it. "#4" answers almost none of what a fan wants from a table: who is
 * above them, by how many points, how many games in hand, who they are chasing.
 * A table is a table precisely because the rows next to yours are the
 * information.
 *
 * Two modes, one component, because they must not drift:
 *  - `focusWindow()`: this club's row plus its immediate neighbours, for the
 *    Overview tab, where the table is context rather than the subject.
 *  - the full list, for the Table tab.
 *
 * ## Zones
 *
 * The coloured rail down the left of a row comes from `standings.zone_description`
 * — the PROVIDER's own sentence ("Promotion - Champions League (Group Stage)",
 * "Relegation - Championship"), stored verbatim by migration 0117. KIVO asserts
 * nothing about which positions qualify for what: it groups rows that carry the
 * same sentence, colours those groups apart, and prints the sentences in a
 * legend so the colour is never the only place the meaning appears.
 *
 * The one piece of reading this does is the word "relegation" in the provider's
 * own text, which decides whether a zone is drawn in the warning palette rather
 * than the accent one. That is the provider's classification being rendered,
 * not KIVO's being invented — and a row with no zone gets no rail at all, since
 * a blank chip in a zone column would read as a claim of mid-table safety.
 */
export type StandingRow = {
  teamId: string;
  teamName: string;
  shortName: string | null;
  crestUrl: string | null;
  position: number | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  /** The provider's own qualification sentence, verbatim. Null on most rows. */
  zoneDescription: string | null;
  /** "Group A" and friends. Null in a single-table league. */
  groupLabel: string | null;
};

/** How many rows either side of this club a focused table keeps. Three above
 * and three below is the window a promotion or relegation fight is actually
 * fought in, and it fits a phone without scrolling. */
const FOCUS_RADIUS = 3;

export function focusWindow(rows: StandingRow[], teamId: string): StandingRow[] {
  const index = rows.findIndex((row) => row.teamId === teamId);
  if (index === -1) return rows.slice(0, FOCUS_RADIUS * 2 + 1);
  const start = Math.max(0, index - FOCUS_RADIUS);
  return rows.slice(start, start + FOCUS_RADIUS * 2 + 1);
}

/**
 * Splits a season's rows into its real groups. A Champions League group stage
 * is eight tables, not one 32-row ladder, and `position` restarts at 1 in each
 * — so rendering them as one list produces eight teams all claiming to be
 * first. Returns a single unlabelled group for an ordinary league.
 */
export function groupStandings(rows: StandingRow[]): { label: string | null; rows: StandingRow[] }[] {
  const labels = Array.from(new Set(rows.map((row) => row.groupLabel)));
  if (labels.length <= 1) return rows.length > 0 ? [{ label: labels[0] ?? null, rows }] : [];
  return labels.map((label) => ({ label, rows: rows.filter((row) => row.groupLabel === label) }));
}

/** Rows sharing a sentence share a colour. The palette is assigned in table
 * order, so the top zone of a table reads as the accent one; anything the
 * provider itself calls a relegation gets the warning palette instead. */
type ZoneTone = { rail: string; swatch: string };

const ZONE_TONES: ZoneTone[] = [
  { rail: "bg-accent", swatch: "bg-accent" },
  { rail: "bg-live", swatch: "bg-live" },
  { rail: "bg-info", swatch: "bg-info" },
];
const RELEGATION_TONES: ZoneTone[] = [
  { rail: "bg-critical", swatch: "bg-critical" },
  { rail: "bg-warning", swatch: "bg-warning" },
];

function buildZoneTones(rows: StandingRow[]): Map<string, ZoneTone> {
  const tones = new Map<string, ZoneTone>();
  let qualifying = 0;
  let relegating = 0;
  for (const row of rows) {
    const zone = row.zoneDescription?.trim();
    if (!zone || tones.has(zone)) continue;
    if (/relegat/i.test(zone)) {
      tones.set(zone, RELEGATION_TONES[Math.min(relegating, RELEGATION_TONES.length - 1)]);
      relegating += 1;
    } else {
      tones.set(zone, ZONE_TONES[Math.min(qualifying, ZONE_TONES.length - 1)]);
      qualifying += 1;
    }
  }
  return tones;
}

function goalDifference(row: StandingRow): number {
  return row.goalsFor - row.goalsAgainst;
}

export function LeagueTable({
  rows,
  highlightTeamId,
  caption,
  /** Whether to print the zone legend under the table. Off for the Overview's
   * focused window, where three rows out of twenty cannot show a legend that
   * describes the whole table without implying it does. */
  showZoneLegend = false,
}: {
  rows: StandingRow[];
  highlightTeamId: string;
  /** The competition and season this table is of. Always shown, because a
   * table with no name is a table of nothing in particular — and a club in a
   * league and a cup group has more than one. */
  caption?: string | null;
  showZoneLegend?: boolean;
}) {
  if (rows.length === 0) return null;

  const zoneTones = buildZoneTones(rows);
  const legend = Array.from(zoneTones.entries());

  return (
    <div className="kivo-glass overflow-hidden rounded-2xl">
      {caption && (
        <p className="border-b border-hairline-soft px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-foreground-subtle">
          {caption}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[20rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline-soft text-[10px] uppercase tracking-[0.06em] text-foreground-subtle">
              <th scope="col" className="w-9 px-2 py-2 text-center font-medium">
                #
              </th>
              <th scope="col" className="px-1 py-2 text-left font-medium">
                Team
              </th>
              <th scope="col" className="w-8 px-1 py-2 text-center font-medium">
                P
              </th>
              {/* W/D/L are the first thing to go on a narrow screen: they are
                  recoverable from played and points for anyone who wants them,
                  and position and points are not recoverable from anything. */}
              <th scope="col" className="hidden w-8 px-1 py-2 text-center font-medium sm:table-cell">
                W
              </th>
              <th scope="col" className="hidden w-8 px-1 py-2 text-center font-medium sm:table-cell">
                D
              </th>
              <th scope="col" className="hidden w-8 px-1 py-2 text-center font-medium sm:table-cell">
                L
              </th>
              <th scope="col" className="w-10 px-1 py-2 text-center font-medium">
                GD
              </th>
              <th scope="col" className="w-10 px-2 py-2 text-center font-medium">
                Pts
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline-soft">
            {rows.map((row) => {
              const isThisTeam = row.teamId === highlightTeamId;
              const gd = goalDifference(row);
              const zone = row.zoneDescription?.trim() || null;
              const tone = zone ? zoneTones.get(zone) : undefined;
              return (
                <tr
                  key={row.teamId}
                  className={isThisTeam ? "bg-accent-soft" : undefined}
                  aria-current={isThisTeam ? "true" : undefined}
                >
                  <td className="relative px-2 py-1.5 text-center text-[11px] font-semibold tabular-nums text-foreground-subtle">
                    {tone && (
                      <span
                        aria-hidden="true"
                        className={`absolute inset-y-0 left-0 w-[3px] ${tone.rail}`}
                      />
                    )}
                    {row.position ?? "–"}
                    {/* The colour is decoration; this is where the meaning
                        actually lives for anyone not reading colours. */}
                    {zone && <span className="sr-only">, {zone}</span>}
                  </td>
                  <td className="min-w-0 px-1 py-1.5">
                    <Link
                      href={`/teams/${row.teamId}`}
                      className="kivo-focus flex min-h-[2.75rem] items-center gap-2 transition hover:text-accent"
                    >
                      <TeamCrest crestUrl={row.crestUrl} name={row.teamName} size={20} />
                      <span
                        className={`min-w-0 flex-1 truncate text-[13px] ${isThisTeam ? "font-semibold text-foreground" : "text-foreground-muted"}`}
                      >
                        {row.shortName ?? row.teamName}
                      </span>
                    </Link>
                  </td>
                  <td className="px-1 py-1.5 text-center text-[13px] tabular-nums text-foreground-muted">{row.played}</td>
                  <td className="hidden px-1 py-1.5 text-center text-[13px] tabular-nums text-foreground-muted sm:table-cell">
                    {row.won}
                  </td>
                  <td className="hidden px-1 py-1.5 text-center text-[13px] tabular-nums text-foreground-muted sm:table-cell">
                    {row.drawn}
                  </td>
                  <td className="hidden px-1 py-1.5 text-center text-[13px] tabular-nums text-foreground-muted sm:table-cell">
                    {row.lost}
                  </td>
                  <td className="px-1 py-1.5 text-center text-[13px] tabular-nums text-foreground-muted">
                    {gd > 0 ? `+${gd}` : gd}
                  </td>
                  <td className="px-2 py-1.5 text-center text-[13px] font-semibold tabular-nums text-foreground">
                    {row.points}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showZoneLegend && legend.length > 0 && (
        <ul className="flex flex-col gap-1.5 border-t border-hairline-soft px-4 py-3">
          {legend.map(([zone, tone]) => (
            <li key={zone} className="flex items-center gap-2 text-[11px] text-foreground-muted">
              <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${tone.swatch}`} />
              {/* Verbatim. KIVO does not paraphrase a qualification rule it did
                  not write. */}
              <span className="min-w-0">{zone}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
