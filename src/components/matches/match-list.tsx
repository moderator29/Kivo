import type { ReactNode } from "react";
import Link from "next/link";
import { TeamCrest } from "@/components/ui/team-crest";
import { formatKickoff, isLiveStatus, STATUS_LABEL, type FixtureStatus } from "@/lib/football/fixture-status";

/**
 * KIVO's match list: ONE surface per competition, matches as rows inside it.
 *
 * ## Why this component exists
 *
 * Every fixture on /matches, /live, a team page and a venue page was its own
 * `kivo-glass rounded-2xl p-4` card, stacked with `gap-2`. Ten matches meant ten
 * borders, ten shadows, ten backdrop-blurred surfaces and nine gaps — and because
 * a stat panel, a settings group and a match all wore that same box, nothing on
 * screen had a rank. That is the "everything is a card, and it all feels the
 * same" the founder was reacting to, and it is also why a phone screen fit about
 * five matches where Sofascore and FotMob fit ten.
 *
 * KIVO's own design system already prescribed the fix and the code had drifted
 * off it. `CONTAINER_ROLES.row` (src/lib/design-system.ts): "One item among many
 * inside a grouped card. It inherits the card's corners and is separated by a
 * hairline, never by its own box — stacked boxes are what makes a list look
 * cluttered." And `DENSITY_RULES`, "One divider weight per boundary": "Do not
 * stack a card inside a card to separate two rows." So this is not a new opinion;
 * it is the rule the system already carried, finally applied to its densest list.
 *
 * ## The row's shape, and why
 *
 * Three columns, and the first two are what make the list scannable:
 *
 *   1. A fixed-width time rail. Kickoff (or FT, or 67') for every row sits on the
 *      same vertical line, so the eye reads the column, not each row in turn.
 *      Every reference app does this and none of them let the time float.
 *   2. Both teams stacked, home over away — the shape of a scoreline as it is
 *      written and spoken. One row is one match, not two.
 *   3. Scores right-aligned and tabular, with the LOSING side dimmed. That single
 *      contrast step is what lets a reader take a result in without reading two
 *      numbers and comparing them; a draw dims neither.
 *
 * ## What it deliberately does not do
 *
 * No score is invented, no minute is guessed. A fixture with null scores shows
 * nothing in the score column rather than a dash or a zero, and the time rail
 * falls back to the scheduled kickoff. This component is entirely presentational
 * and takes only fields the fixture really has.
 */

export type MatchListFixture = {
  id: string;
  kickoff_at: string;
  status: FixtureStatus;
  home_score: number | null;
  away_score: number | null;
  minute_elapsed?: number | null;
  // No team `id` required: the row navigates to Match Centre and nowhere else.
  // The old card carried a link on each team name, which meant four tab stops
  // and four accessible names per match; a dense results list is read, not
  // navigated sideways from, and every reference app takes the same view.
  home_team: { name: string; crest_url: string | null } | null;
  away_team: { name: string; crest_url: string | null } | null;
};

/**
 * The grouped surface. One per competition — the competition's own header sits
 * ABOVE this, outside the box, so the box holds only matches.
 */
export function MatchList({
  children,
  /**
   * `inset` drops the glass surface and corners, for a list that already sits
   * inside a panel — Home's section cards, for instance. Without it those rows
   * would be a card inside a card, which is the exact nesting `DENSITY_RULES`
   * ("one divider weight per boundary") tells us not to build.
   */
  inset = false,
  className = "",
}: {
  children: ReactNode;
  inset?: boolean;
  className?: string;
}) {
  return (
    <div className={`${inset ? "-mx-2" : "kivo-glass overflow-hidden rounded-2xl"} ${className}`}>
      <ul className="flex flex-col divide-y divide-hairline-soft">{children}</ul>
    </div>
  );
}

/**
 * Short forms for the rail. `STATUS_LABEL`'s own words ("Postponed",
 * "Abandoned") are correct on a match page and too long for a 44px column —
 * these are the abbreviations a results grid has used since printed ones.
 */
const RAIL_LABEL: Partial<Record<FixtureStatus, string>> = {
  finished: "FT",
  halftime: "HT",
  postponed: "Postp.",
  cancelled: "Canc.",
  abandoned: "Aband.",
};

/**
 * The time rail. ONE line, always, so the column reads as a column.
 *
 * What goes in it depends on what the reader actually needs from that match:
 * a scheduled match needs its kickoff, a live one needs the minute, and a
 * finished one needs "FT" — its kickoff time is three hours of no consequence
 * and printing it alongside the result was the noisiest thing in this list.
 */
function TimeRail({ fixture }: { fixture: MatchListFixture }) {
  const live = isLiveStatus(fixture.status);

  const label = live
    ? fixture.status === "halftime"
      ? "HT"
      : fixture.minute_elapsed != null
        ? `${fixture.minute_elapsed}'`
        : "Live"
    : fixture.status === "scheduled"
      ? formatKickoff(fixture.kickoff_at)
      : (RAIL_LABEL[fixture.status] ?? STATUS_LABEL[fixture.status]);

  return (
    <div className="flex w-11 shrink-0 flex-col items-center justify-center gap-1 self-center">
      <span
        className={`text-[11px] font-semibold tabular-nums leading-none ${
          live ? "text-live" : "text-foreground-subtle"
        }`}
      >
        {label}
      </span>
      {live && (
        <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full rounded-full bg-live opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-live" />
        </span>
      )}
    </div>
  );
}

function TeamLine({
  team,
  score,
  dim,
  fallback,
}: {
  team: MatchListFixture["home_team"];
  score: number | null;
  /** True for the side that lost. A draw dims neither. */
  dim: boolean;
  fallback: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <TeamCrest crestUrl={team?.crest_url ?? null} name={team?.name ?? fallback} size={18} />
      <span className={`min-w-0 flex-1 truncate text-sm ${dim ? "text-foreground-muted" : "text-foreground"}`}>
        {team?.name ?? fallback}
      </span>
      {score !== null && (
        <span
          className={`w-4 shrink-0 text-right text-sm font-semibold tabular-nums ${
            dim ? "text-foreground-muted" : "text-foreground"
          }`}
        >
          {score}
        </span>
      )}
    </div>
  );
}

/**
 * The row's contents, without the `<li>` around them.
 *
 * Exported because `/live` needs to wrap each row in a `motion.li` of its own —
 * it FLIP-animates rows that reorder as scores change, and a `motion.div` around
 * an `<li>` would be invalid inside a `<ul>`. Everything else should use
 * `MatchListRow`, which is this plus its list item.
 *
 * Keeping the two in one file is deliberate: it is what stops /live's row and
 * /matches' row from drifting into two different-looking match rows again, which
 * is exactly what had happened before this component existed.
 */
export function MatchListRowContent({
  fixture,
  /**
   * Optional per-match extras that belong to the row but are not the match:
   * "8 people in the Room", "2 of your fantasy players are here". Rendered
   * beneath the two team lines and OUTSIDE the stretched link, so anything
   * interactive in here keeps its own click target instead of being swallowed
   * by the row's navigation.
   */
  meta,
}: {
  fixture: MatchListFixture;
  meta?: ReactNode;
}) {
  const hasScore = fixture.home_score !== null && fixture.away_score !== null;
  const homeLost = hasScore && fixture.home_score! < fixture.away_score!;
  const awayLost = hasScore && fixture.away_score! < fixture.home_score!;

  const homeName = fixture.home_team?.name ?? "Home team";
  const awayName = fixture.away_team?.name ?? "Away team";

  return (
    <>
      {/* One stretched link per row rather than a link around everything: the
          whole row navigates to Match Centre, and it is a single tab stop with a
          single accessible name instead of the four the old card produced. */}
      <Link
        href={`/matches/${fixture.id}`}
        aria-label={`${homeName} versus ${awayName}, match centre`}
        className="kivo-focus flex items-stretch gap-3 px-3 py-2 transition-colors hover:bg-surface-2"
      >
        <TimeRail fixture={fixture} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <TeamLine team={fixture.home_team} score={fixture.home_score} dim={homeLost} fallback="Home team" />
          <TeamLine team={fixture.away_team} score={fixture.away_score} dim={awayLost} fallback="Away team" />
        </div>
      </Link>
      {meta && <div className="px-3 pb-2 pl-[3.5rem]">{meta}</div>}
    </>
  );
}

export function MatchListRow(props: { fixture: MatchListFixture; meta?: ReactNode; className?: string }) {
  const { className = "", ...rest } = props;
  return (
    <li className={`relative ${className}`}>
      <MatchListRowContent {...rest} />
    </li>
  );
}

/**
 * The skeleton for a match list — the same geometry as `MatchListRow`, because a
 * skeleton whose shape differs from what replaces it produces a reflow at the
 * exact moment the reader starts reading. That jolt is most of what makes
 * loading feel unpolished, and it is entirely avoidable: the rail is the same
 * 44px, the two team lines are the same height, the score column is the same
 * width, and the rows are divided by the same hairline.
 *
 * Sized to the surface it fills rather than a fixed count, so a list that will
 * hold three matches does not flash six grey rows and then collapse.
 */
export function MatchListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="kivo-glass overflow-hidden rounded-2xl" aria-hidden="true">
      <div className="flex flex-col divide-y divide-hairline-soft">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-stretch gap-3 px-3 py-2">
            <div className="flex w-11 shrink-0 items-center justify-center">
              <div className="kivo-skeleton h-3 w-8 rounded" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {[0, 1].map((line) => (
                <div key={line} className="flex items-center gap-2">
                  <div className="kivo-skeleton h-[18px] w-[18px] shrink-0 rounded-full" />
                  {/* Two different name widths, alternating, so the block reads
                      as a list of different clubs rather than as a grid. */}
                  <div className={`kivo-skeleton h-3.5 rounded ${line === 0 ? "w-32" : "w-24"}`} />
                  <div className="ml-auto kivo-skeleton h-3.5 w-4 shrink-0 rounded" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
