import Link from "next/link";
import { Shield } from "lucide-react";
import { TeamCrest } from "@/components/ui/team-crest";
import { cn } from "@/lib/utils";
import { standingsZoneLegend, type StandingsZoneKind } from "@/lib/football/standings-zones";
import type { StandingsGroup, StandingsMovement, StandingsTableRow } from "@/lib/football/standings-table";
import type { FormResult } from "@/lib/football/results";

/**
 * KIVO's league table.
 *
 * The densest and most-read component in any football product, so the rules it
 * follows are worth stating rather than leaving in the class names.
 *
 * ## Alignment is the whole job
 *
 * Every number is `tabular-nums` and right-aligned, set once on the `<table>`
 * so no cell can opt out — in this app that utility also carries the mono face
 * (see globals.css), which is why the club-name cell explicitly opts back into
 * the sans one. Proportional digits make a column of two-digit
 * points totals visibly ragged, and a ragged column stops being scannable —
 * the reader ends up reading each number instead of reading the column. Goal
 * difference carries an explicit `+` for positives, because "+12" and "12"
 * differ by a sign a reader should not have to infer from the row above.
 *
 * ## Hairlines, not zebra
 *
 * `DENSITY_RULES` in src/lib/design-system.ts: one divider weight per
 * boundary. Rows are separated by the soft hairline and nothing else, and the
 * only fill on a row is a hover state or a genuine highlight. Zebra striping
 * would put a second boundary between every pair of rows and make a 20-row
 * table read as ten bands of two.
 *
 * ## The mobile column strategy is a choice, not a shrink
 *
 * A phone gets the five columns that answer "where are we and how did we get
 * there": position, club, played, goal difference, points. The rest appear as
 * the table gets room, in the order set out at `COLUMN_TIER` below. Nothing
 * scrolls sideways — a horizontally scrolled league table hides the points
 * column, which is the one column nobody can do without. The club column takes
 * every pixel the numbers do not, which is what keeps "Wolverhampton
 * Wanderers" whole on a phone rather than truncated beside a column of white
 * space.
 *
 * ## Colour makes a claim, so it is only drawn from a stated fact
 *
 * The zone bar down the left edge of a row is the competition's own
 * description of that place, classified by `classifyStandingsZone`. KIVO never
 * derives a zone from a position number — see that module for why. A row with
 * no stated zone gets no bar, and a table with no stated zones anywhere gets
 * no key.
 */

export type StandingsTableProps = {
  groups: StandingsGroup[];
  /**
   * Clubs to mark as the reader's own — their followed teams. Drawn as a
   * tinted row plus a left accent edge, the way a fan expects their club to
   * be findable in a 20-row table without reading it.
   */
  highlightTeamIds?: ReadonlySet<string>;
  /** Rendered under the table, above the key. Used for the "last updated"
   * line the competition page supplies. */
  footnote?: React.ReactNode;
  className?: string;
};

/** Each zone kind's bar colour and its dot in the key. `other` — a real
 * description KIVO could not classify — deliberately gets a neutral mark
 * rather than a colour: the sentence is true and is shown, but KIVO does not
 * pretend to know which of the five things it is. */
const ZONE_BAR: Record<StandingsZoneKind, string> = {
  champions: "bg-zone-champions",
  europe: "bg-zone-europe",
  promotion: "bg-zone-promotion",
  playoff: "bg-zone-playoff",
  relegation: "bg-zone-relegation",
  other: "bg-hairline-strong",
};

/**
 * When each optional column appears, expressed as a **container** query rather
 * than a viewport one.
 *
 * This is the whole mobile column strategy, and it is keyed to the table's own
 * width on purpose. A viewport query gets it wrong in both directions: a phone
 * held sideways is 844px wide and still has a narrow table, while this same
 * component inside a two-column desktop layout would be handed nine columns in
 * a 400px slot. What decides whether a column fits is how much room the table
 * has, so that is what is measured.
 *
 * The reveal order is by usefulness, not by the order the columns are drawn in.
 * Wins/draws/losses come first because they are the shape of a season; the form
 * guide next, because five recent results tell a reader more than a goals-for
 * total; goals for and against last, since goal difference — which is always
 * shown — already carries most of what they say.
 */
type ColumnTier = "record" | "form" | "goals";

const COLUMN_TIER: Record<ColumnTier, string> = {
  record: "hidden @lg:table-cell",
  form: "hidden @xl:table-cell",
  goals: "hidden @4xl:table-cell",
};

export function StandingsTable({ groups, highlightTeamIds, footnote, className }: StandingsTableProps) {
  const legend = standingsZoneLegend(groups.flatMap((group) => group.rows.map((row) => row.zone)));

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {groups.map((group) => (
        <div key={group.key} className="@container kivo-glass overflow-hidden rounded-2xl">
          {group.label && (
            <h3 className="border-b border-hairline-soft px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
              {group.label}
            </h3>
          )}
          <StandingsGroupTable group={group} highlightTeamIds={highlightTeamIds} />
        </div>
      ))}

      {footnote}

      {legend.length > 0 && (
        <ul className="flex flex-col gap-1.5 px-1 pt-1">
          {legend.map((zone) => (
            <li key={zone.label} className="flex items-center gap-2 text-[11px] text-foreground-muted">
              <span
                aria-hidden="true"
                className={cn("h-2.5 w-1 shrink-0 rounded-full", ZONE_BAR[zone.kind])}
              />
              {/* The competition's exact words. Never paraphrased, never
                  shortened — a key that rewrites the source is a key that can
                  be wrong about it. */}
              {zone.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StandingsGroupTable({
  group,
  highlightTeamIds,
}: {
  group: StandingsGroup;
  highlightTeamIds?: ReadonlySet<string>;
}) {
  return (
    // Set once, inherited by every cell: no number in this table can render
    // with proportional digits.
    <table className="w-full border-collapse tabular-nums">
      <caption className="sr-only">
        {group.label ? `${group.label} table` : "League table"}
      </caption>
      <thead>
        <tr className="border-b border-hairline text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
          <th scope="col" className="w-14 py-2 pl-3 pr-1 text-right font-semibold">
            <span className="sr-only">Position</span>
            <span aria-hidden="true">#</span>
          </th>
          {/* Every stat column is given a fixed width and the club column is
              given `w-full`, which is how a table hands one column all the
              space the others do not need. Without the fixed widths the auto
              layout shares the surplus across all eleven columns and the club
              names truncate while the number columns sit in white space. */}
          <th scope="col" className="w-full py-2 pl-2 pr-2 text-left font-sans font-semibold">
            Club
          </th>
          <HeadCell label="Played" short="P" />
          <HeadCell label="Won" short="W" from="record" />
          <HeadCell label="Drawn" short="D" from="record" />
          <HeadCell label="Lost" short="L" from="record" />
          <HeadCell label="Goals for" short="GF" from="goals" />
          <HeadCell label="Goals against" short="GA" from="goals" />
          <HeadCell label="Goal difference" short="GD" />
          <th scope="col" className="w-12 py-2 pl-2 pr-3 text-right font-semibold text-foreground-muted">
            <span className="sr-only">Points</span>
            <span aria-hidden="true">Pts</span>
          </th>
          <th scope="col" className={cn("w-[6.75rem] py-2 pr-3 text-left font-semibold", COLUMN_TIER.form)}>
            Form
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-hairline-soft">
        {group.rows.map((row) => (
          <StandingsRow key={row.teamId} row={row} highlighted={highlightTeamIds?.has(row.teamId) ?? false} />
        ))}
      </tbody>
    </table>
  );
}

/**
 * A stat column head. The full word is in the accessible name and the
 * abbreviation is what is drawn — "GD" is meaningless read aloud, and
 * expanding it in the visible header would cost the column more width than the
 * numbers under it need.
 */
function HeadCell({ label, short, from }: { label: string; short: string; from?: ColumnTier }) {
  return (
    <th scope="col" className={cn("w-10 py-2 pl-2 text-right font-semibold", from && COLUMN_TIER[from])}>
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">{short}</span>
    </th>
  );
}

function StandingsRow({ row, highlighted }: { row: StandingsTableRow; highlighted: boolean }) {
  return (
    <tr
      className={cn(
        "transition-colors hover:bg-surface-2",
        highlighted && "bg-accent-soft",
      )}
    >
      {/* The zone bar lives inside the position cell as a positioned element
          rather than as a cell border, so it runs the FULL height of the row
          including its padding and meets the rows above and below with no
          seam. A border would be inset by the row's own divider and read as a
          stack of dashes. */}
      <td className="relative w-14 py-2.5 pl-3 pr-1 text-right">
        {row.zone ? (
          <span aria-hidden="true" className={cn("absolute inset-y-0 left-0 w-[3px]", ZONE_BAR[row.zone.kind])} />
        ) : highlighted ? (
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-accent" />
        ) : null}
        <span className="flex items-center justify-end gap-1">
          <MovementMark movement={row.movement} />
          {/* Empty rather than a dash when the competition stated no position:
              a dash in a position column reads as a place. */}
          <span className="text-xs font-medium text-foreground-subtle">{row.position ?? ""}</span>
        </span>
        {row.zone && <span className="sr-only">{row.zone.label}. </span>}
      </td>

      {/* `font-sans` because the table sets `tabular-nums`, and in this app
          that utility also swaps in the mono face (globals.css) — which is
          right for every number here and wrong for a club's name. */}
      <th scope="row" className="w-full max-w-0 py-2.5 pl-2 pr-2 text-left font-sans font-normal">
        {row.team ? (
          <Link
            href={`/teams/${row.team.id}`}
            className="kivo-focus flex items-center gap-2 rounded-lg"
          >
            <TeamCrest crestUrl={row.team.crestUrl} name={row.team.name} size={20} />
            <span className="truncate text-sm text-foreground">{row.team.name}</span>
          </Link>
        ) : (
          // A standings row whose club KIVO cannot resolve keeps its numbers —
          // they are still the competition's — and says plainly that the club
          // is the missing part rather than borrowing a name from nowhere.
          <span className="flex items-center gap-2">
            <Shield className="h-5 w-5 shrink-0 text-foreground-subtle" strokeWidth={1.75} aria-hidden="true" />
            <span className="truncate text-sm text-foreground-subtle">Club not listed</span>
          </span>
        )}
      </th>

      <StatCell value={row.played} />
      <StatCell value={row.won} from="record" />
      <StatCell value={row.drawn} from="record" />
      <StatCell value={row.lost} from="record" />
      <StatCell value={row.goalsFor} from="goals" />
      <StatCell value={row.goalsAgainst} from="goals" />
      <td className="w-10 py-2.5 pl-2 text-right text-xs text-foreground-muted">
        {formatGoalDifference(row.goalDifference)}
      </td>
      <td className="w-12 py-2.5 pl-2 pr-3 text-right text-sm font-semibold text-foreground">{row.points}</td>
      <td className={cn("py-2.5 pr-3", COLUMN_TIER.form)}>
        <FormStrip form={row.form} />
      </td>
    </tr>
  );
}

function StatCell({ value, from }: { value: number; from?: ColumnTier }) {
  return (
    <td className={cn("w-10 py-2.5 pl-2 text-right text-xs text-foreground-muted", from && COLUMN_TIER[from])}>
      {value}
    </td>
  );
}

/** `+12`, `-3`, `0`. The sign on a positive difference is the point of the
 * column; without it the reader has to compare two other columns to recover
 * it. Zero is drawn bare, because "+0" is not a thing anyone writes. */
export function formatGoalDifference(difference: number): string {
  if (difference > 0) return `+${difference}`;
  return String(difference);
}

/**
 * The movement mark: a small triangle for a climb or a fall, nothing at all
 * for level or unknown.
 *
 * Nothing, deliberately, in both of those cases — but they are not the same
 * state and the accessible name says which. A dash for "no change" would put a
 * mark in every row of a table that has not moved since the last matchday,
 * which is most tables most of the time, and it would compete with the zone
 * bar for the same 12 pixels.
 */
function MovementMark({ movement }: { movement: StandingsMovement }) {
  if (movement === null || movement === "level") return null;
  const up = movement === "up";
  return (
    <span
      className={cn("text-[8px] leading-none", up ? "text-live" : "text-critical")}
      title={up ? "Up since this club last played" : "Down since this club last played"}
    >
      <span aria-hidden="true">{up ? "▲" : "▼"}</span>
      <span className="sr-only">{up ? "Up" : "Down"} since this club last played.</span>
    </span>
  );
}

const FORM_STYLE: Record<FormResult, string> = {
  W: "bg-live/15 text-live",
  D: "bg-surface-2 text-foreground-muted",
  L: "bg-critical/15 text-critical",
};

const FORM_WORD: Record<FormResult, string> = { W: "Won", D: "Drew", L: "Lost" };

/**
 * Five results, newest first — the same orientation as `FormBadges` on the
 * team pages, so a reader who learns it once never has to relearn it.
 *
 * Sized down to 16px squares rather than reusing the 28px badges: at table
 * density a strip of five 28px circles is taller than the row it sits in and
 * would set the height of every row in the table.
 */
function FormStrip({ form }: { form: FormResult[] }) {
  if (form.length === 0) {
    // No finished matches KIVO holds for this club. Blank rather than five
    // grey placeholders, which would read as five drawn games.
    return <span className="sr-only">No recent results.</span>;
  }
  return (
    <span className="flex items-center gap-1">
      <span className="sr-only">
        Recent results, most recent first: {form.map((result) => FORM_WORD[result]).join(", ")}.
      </span>
      {form.map((result, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] font-semibold",
            FORM_STYLE[result],
          )}
        >
          {result}
        </span>
      ))}
    </span>
  );
}
