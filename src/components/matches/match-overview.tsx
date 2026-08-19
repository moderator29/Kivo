"use client";

import type { ReactNode } from "react";
import { FormBadges } from "@/components/teams/form-badges";
import { Section } from "@/components/ui/section";
import { ListSurface, ListRow } from "@/components/ui/list-surface";
import { StatBlock, StatGrid } from "@/components/ui/stat-block";
import { LocalDateTime } from "@/components/ui/relative-time";
import { TeamCrest } from "@/components/ui/team-crest";
import { EVENT_LABEL, isGoalEventType } from "@/lib/football/event-labels";
import type { FormSummary } from "@/lib/football/form-engine";
import type { HeadToHeadRecord } from "@/lib/football/head-to-head";
import type { FixtureStatus } from "@/lib/football/fixture-status";
import { roundText } from "@/lib/football/round-label";

/**
 * The Match Centre's front page.
 *
 * Overview used to be a consolation prize: it existed only while every data
 * tab was empty, and disappeared the moment one filled — so a fan opening a
 * finished match landed on a raw event list with no summary anywhere, and a
 * fan opening a scheduled one got a single apologetic sentence. Both are now
 * the same screen, and it is always the first tab.
 *
 * What it holds is everything KIVO can say about *this* match without opening
 * anything else: how the match ran, how both clubs arrived, what has happened
 * between them before, where they sit in the table, and the facts of the
 * fixture itself. Every section renders only when its own data is real, and
 * the ones that are missing are absent rather than stubbed — an empty card
 * with a dash in it is a claim about the match, not about the data.
 */

export type MatchOverviewFacts = {
  kickoffAt: string;
  status: FixtureStatus;
  competitionName: string | null;
  venueName: string | null;
  venueCity: string | null;
  referee: string | null;
  roundLabel: string | null;
  matchday: number | null;
};

export type OverviewEvent = {
  id: string;
  eventType: keyof typeof EVENT_LABEL;
  minute: number;
  addedTime: number | null;
  teamId: string;
  playerName: string | null;
};

export type OverviewStandingsRow = {
  teamId: string;
  teamName: string;
  crestUrl: string | null;
  played: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  position: number | null;
};

/**
 * One region of the front page.
 *
 * This used to be a local `SectionCard`: a glass box with an 11px caps title
 * and an icon, repeated five times down the page. Five surfaces of identical
 * weight is exactly the "stack of cards with no shape" the shared primitives
 * exist to end — nothing on the screen said which of these was the headline
 * and which was context, because they all looked the same.
 *
 * So the region itself has no surface now. Its content brings one only where
 * the content genuinely is a unit: a plotted chart, a list of rows, a grid of
 * numbers. Prose does not, and neither does a heading.
 */
function OverviewSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  // `as="h3"`: these sit under the match's own heading, and a skipped level is
  // the most common way a well-built page still reads as a jumble aloud.
  return (
    <Section as="h3" title={title} action={action}>
      {children}
    </Section>
  );
}

function TabLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-full border border-hairline px-2.5 py-1 text-[11px] font-semibold text-foreground-muted transition hover:border-accent/40 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {label}
    </button>
  );
}

/**
 * The shape of the match on one line: every goal and dismissal placed on the
 * clock, home above the axis and away below it.
 *
 * This is deliberately **not** called momentum, and it is not one. A momentum
 * chart is built from possession and territory sampled minute by minute, and
 * KIVO's provider publishes neither at any tier — drawing a pressure curve
 * from nine discrete events would be an invention dressed as analysis. What
 * the event minutes genuinely support is *when* the match turned, so that is
 * what this draws and what it says it is.
 */
function MatchFlow({
  events,
  homeTeamId,
  homeTeamName,
  awayTeamName,
  status,
}: {
  events: OverviewEvent[];
  homeTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  status: FixtureStatus;
}) {
  const marked = events.filter(
    (event) => isGoalEventType(event.eventType) || event.eventType === "own_goal" || event.eventType === "red_card" || event.eventType === "second_yellow_card",
  );
  if (marked.length === 0) return null;

  // The axis runs to 90 or to the last recorded minute, whichever is later, so
  // a 96th-minute winner is inside the strip rather than clipped off its end.
  const lastMinute = marked.reduce((max, event) => Math.max(max, event.minute), 90);
  const position = (minute: number) => Math.min(100, Math.max(0, (minute / lastMinute) * 100));

  return (
    <div className="flex flex-col gap-2">
      {/* Inset by half a marker so a 1st-minute goal and a 90+4 winner both sit
          fully inside the card instead of half off its edge. */}
      <div className="relative mx-3 h-16">
        <span aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-hairline" />
        {/* Half time, the one interior division of a football clock that is
            always in the same place. Only drawn once the axis is long enough
            for it to mean something. */}
        {lastMinute >= 60 && (
          <span
            aria-hidden
            className="absolute top-1/2 h-6 w-px -translate-y-1/2 bg-hairline-soft"
            style={{ left: `${position(45)}%` }}
          />
        )}
        {marked.map((event) => {
          const isHome = event.teamId === homeTeamId;
          const scored = isGoalEventType(event.eventType);
          const own = event.eventType === "own_goal";
          return (
            <span
              key={event.id}
              aria-hidden
              title={`${event.minute}' ${EVENT_LABEL[event.eventType]}${event.playerName ? ` — ${event.playerName}` : ""}`}
              className={`absolute flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border text-[9px] font-bold ${
                isHome ? "top-0" : "bottom-0"
              } ${
                scored
                  ? "border-accent/40 bg-accent text-on-accent"
                  : own
                    ? "border-critical/40 bg-critical text-kivo-white"
                    : "border-critical/40 bg-critical/15 text-critical"
              }`}
              style={{ left: `${position(event.minute)}%` }}
            >
              {scored ? "⚽" : own ? "OG" : "R"}
            </span>
          );
        })}
      </div>
      {/* The words "above" and "below" cost each club name about seven
          characters of a 137px cell on a phone, which was enough to truncate
          both of them. The arrow says the same thing in one glyph. The whole
          row is aria-hidden — the sr-only list underneath states each event's
          side in full — so nothing here is the only carrier of anything. */}
      <div aria-hidden className="flex items-start justify-between gap-2 text-[10px] uppercase tracking-wide text-foreground-subtle">
        <span className="min-w-0 flex-1 truncate">▲ {homeTeamName}</span>
        <span className="shrink-0">{status === "finished" ? "full time" : `${lastMinute}'`}</span>
        <span className="min-w-0 flex-1 truncate text-right">{awayTeamName} ▼</span>
      </div>
      <ul className="sr-only">
        {marked.map((event) => (
          <li key={event.id}>
            {event.minute}
            {event.addedTime ? `+${event.addedTime}` : ""} minutes, {EVENT_LABEL[event.eventType]},{" "}
            {event.teamId === homeTeamId ? homeTeamName : awayTeamName}
            {event.playerName ? `, ${event.playerName}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StandingsMiniRow({ row, highlighted }: { row: OverviewStandingsRow; highlighted: boolean }) {
  return (
    <div className={`flex items-center gap-2 rounded-xl px-2 py-1.5 text-xs ${highlighted ? "bg-accent/5" : ""}`}>
      <span className="w-5 shrink-0 text-right tabular-nums text-foreground-subtle">{row.position ?? "–"}</span>
      <TeamCrest crestUrl={row.crestUrl} name={row.teamName} size={16} />
      <span className="min-w-0 flex-1 truncate text-foreground">{row.teamName}</span>
      <span className="w-6 shrink-0 text-right tabular-nums text-foreground-muted">{row.played}</span>
      <span className="w-8 shrink-0 text-right tabular-nums text-foreground-muted">
        {row.goalsFor - row.goalsAgainst > 0 ? "+" : ""}
        {row.goalsFor - row.goalsAgainst}
      </span>
      <span className="w-7 shrink-0 text-right font-semibold tabular-nums text-foreground">{row.points}</span>
    </div>
  );
}

/** Sentence-cases a fragment that starts a sentence, leaving anything already
 * capitalised alone. */
function capitalise(text: string): string {
  return text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text;
}

/** "stats", "stats and line-ups", "the timeline, stats and line-ups". */
function formatAreaList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function MatchOverview({
  facts,
  homeTeamId,
  awayTeamId,
  homeTeamName,
  awayTeamName,
  events,
  homeForm,
  awayForm,
  headToHead,
  standings,
  competitionCoverage,
  missingAreas,
  onOpenTab,
}: {
  facts: MatchOverviewFacts;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  events: OverviewEvent[];
  /** Real last-five form from finished fixtures KIVO holds. Null when the
   * club has none on record at all — the section then simply says so once
   * rather than drawing an empty badge strip per side. */
  homeForm: FormSummary | null;
  awayForm: FormSummary | null;
  headToHead: HeadToHeadRecord | null;
  standings: OverviewStandingsRow[];
  competitionCoverage: { events: boolean | null; lineups: boolean | null; statistics: boolean | null } | null;
  /** The deep tabs that hold nothing for this fixture yet, in KIVO's own
   * words ("line-ups", "stats", "the timeline"), decided by the tab strip so
   * this panel and the strip cannot disagree about what is missing. */
  missingAreas: string[];
  onOpenTab: (tab: "timeline" | "h2h" | "standings" | "room") => void;
}) {
  const started = facts.status !== "scheduled";
  const venue = [facts.venueName, facts.venueCity].filter(Boolean).join(", ");
  const round = roundText(facts);

  // Only the areas the provider has explicitly said it does NOT publish for
  // this competition. `null` is not a denial — it means the registry has
  // never been read for this competition, or has no opinion, and KIVO says
  // nothing rather than inventing a capability gap it has not established.
  const unsupported = [
    competitionCoverage?.events === false ? "the timeline" : null,
    competitionCoverage?.statistics === false ? "stats" : null,
    competitionCoverage?.lineups === false ? "line-ups" : null,
  ].filter((label): label is string => label !== null);

  // Every row is conditional on KIVO actually holding the fact. An absent row
  // is the only honest rendering of an absent value — the alternative is a
  // label with "Unknown" beside it, which reads as a statement about the match
  // rather than about the data.
  const factRows: { label: string; value: ReactNode }[] = [
    { label: "Kick-off", value: <LocalDateTime iso={facts.kickoffAt} format="deadline" /> },
    ...(facts.competitionName ? [{ label: "Competition", value: facts.competitionName }] : []),
    ...(round ? [{ label: "Round", value: round }] : []),
    ...(venue ? [{ label: "Venue", value: venue }] : []),
    ...(facts.referee ? [{ label: "Referee", value: facts.referee }] : []),
  ];

  const homeRow = standings.find((row) => row.teamId === homeTeamId);
  const awayRow = standings.find((row) => row.teamId === awayTeamId);
  const tableRows = standings.filter((row) => {
    if (row.teamId === homeTeamId || row.teamId === awayTeamId) return true;
    // One neighbour either side of each club, so the two positions are read in
    // context rather than as two numbers floating on their own.
    return [homeRow, awayRow].some(
      (anchor) => anchor?.position != null && row.position != null && Math.abs(row.position - anchor.position) === 1,
    );
  });

  const h2hTotal = headToHead?.meetings.length ?? 0;

  // Two different waits, and they resolve at different moments, so they are
  // two sentences rather than one list with a verb that cannot agree with it.
  // Before kick-off the honest thing to give a fan is the schedule football
  // actually runs on; once the match is under way it is simply "not here yet".
  // Declared once and placed twice (see the two call sites below) so the same
  // card cannot drift into two versions of itself.
  const factsCard = (
    <OverviewSection title="Match facts">
      {/* One surface, hairline-divided rows — not one card per fact. Rows are
          written out rather than using `<ListRow>`, because its `trailing` slot
          is built for a score or a count and sets tabular figures: right for a
          rating, wrong for "Northgate Park, Northgate". The container is still
          the shared one, so the divider weight and the surface match every
          other list in the product. */}
      <ListSurface>
        {factRows.map((fact) => (
          <li key={fact.label} className="flex min-h-11 items-baseline justify-between gap-3 px-4 py-3">
            <span className="shrink-0 text-sm text-foreground-subtle">{fact.label}</span>
            <span className="min-w-0 text-right text-sm font-medium text-foreground">{fact.value}</span>
          </li>
        ))}
      </ListSurface>
    </OverviewSection>
  );

  const afterKickOff = missingAreas.filter((area) => area !== "line-ups");
  const waitingCopy = started
    ? `KIVO doesn't hold ${formatAreaList(missingAreas)} for this match yet. Each one opens as its own tab the moment it lands.`
    : [
        missingAreas.includes("line-ups") ? "Line-ups are published about an hour before kick-off." : null,
        afterKickOff.length > 0
          ? `${capitalise(formatAreaList(afterKickOff))} ${afterKickOff.length === 1 ? "arrives" : "arrive"} once the match is under way.`
          : null,
      ]
        .filter(Boolean)
        .join(" ");

  return (
    <div className="flex flex-col gap-3">
      {/* Before kick-off the fixture's own facts are the whole story, so they
          lead; once there is a match to describe they move below it. */}
      {!started && factsCard}

      {events.length > 0 && (
        <OverviewSection
          title="Match flow"
          action={<TabLink label="Full timeline" onClick={() => onOpenTab("timeline")} />}
        >
          {/* A plotted axis genuinely is one unit, so this is one of the few
              places on the front page that earns a surface of its own. */}
          <div className="kivo-glass rounded-2xl p-4">
          <MatchFlow
            events={events}
            homeTeamId={homeTeamId}
            homeTeamName={homeTeamName}
            awayTeamName={awayTeamName}
            status={facts.status}
          />
          </div>
        </OverviewSection>
      )}

      {(homeForm || awayForm) && (
        <OverviewSection title="Form">
          <ListSurface>
            {[
              { name: homeTeamName, form: homeForm },
              { name: awayTeamName, form: awayForm },
            ].map((side) => (
              <ListRow
                key={side.name}
                title={side.name}
                subtitle={
                  side.form
                    ? // Record and goals, and nothing after them: the badges on
                      // the right take the width a third clause needs, and a
                      // subtitle that ends in "2 pts/…" is worse than one that
                      // stops at something whole.
                      `${side.form.wins}W ${side.form.draws}D ${side.form.losses}L · ${side.form.goalsScored}-${side.form.goalsConceded}`
                    : "No finished matches on record yet."
                }
                trailing={side.form ? <FormBadges form={side.form.sequence} /> : null}
              />
            ))}
          </ListSurface>
          {/* The sample is part of the claim. Five results is the window; a
              club with two finished matches on record gets its two, labelled,
              rather than a five-badge strip padded out of nothing. */}
          <p className="text-[11px] leading-relaxed text-foreground-subtle">
            {homeForm?.isSufficientSample === false || awayForm?.isSufficientSample === false
              ? "Recent results only — one of these clubs has too few finished matches on record for this to be a real form line yet."
              : "Last five finished matches, most recent first."}
          </p>
        </OverviewSection>
      )}

      {headToHead && (
        <OverviewSection
          title="Head to head"
          action={h2hTotal > 0 ? <TabLink label="All meetings" onClick={() => onOpenTab("h2h")} /> : undefined}
        >
          {h2hTotal === 0 ? (
            <p className="text-sm text-foreground-muted">
              This is the first meeting between {homeTeamName} and {awayTeamName} on KIVO&apos;s record.
            </p>
          ) : (
            <StatGrid columns={3}>
              <StatBlock label={`${homeTeamName} wins`} value={headToHead.teamAWins} />
              <StatBlock label="Draws" value={headToHead.draws} />
              <StatBlock label={`${awayTeamName} wins`} value={headToHead.teamBWins} />
            </StatGrid>
          )}
        </OverviewSection>
      )}

      {tableRows.length > 0 && (
        <OverviewSection
          title="In the table"
          action={<TabLink label="Full table" onClick={() => onOpenTab("standings")} />}
        >
          <div className="kivo-glass flex flex-col rounded-2xl p-2">
            <div aria-hidden className="flex items-center gap-2 px-2 pb-1 text-[10px] uppercase tracking-wide text-foreground-subtle">
              <span className="w-5 text-right">#</span>
              <span className="w-4" />
              <span className="min-w-0 flex-1">Team</span>
              <span className="w-6 text-right">P</span>
              <span className="w-8 text-right">GD</span>
              <span className="w-7 text-right">Pts</span>
            </div>
            {tableRows.map((row) => (
              <StandingsMiniRow
                key={row.teamId}
                row={row}
                highlighted={row.teamId === homeTeamId || row.teamId === awayTeamId}
              />
            ))}
          </div>
        </OverviewSection>
      )}

      {started && factsCard}

      {/* Two different sentences, because they are two different facts and a
          fan acts on them differently: "not published yet" means wait, and
          "this competition doesn't carry it" means stop waiting. The second is
          only ever said on the data source's own authority — see
          `competitionCoverage`. Worded without naming a provider, per the
          same de-jargon rule this branch applied to the panel this replaces:
          how KIVO gets its football is not the fan's problem. */}
      {unsupported.length > 0 ? (
        <p className="px-1 text-xs leading-relaxed text-foreground-muted">
          KIVO doesn&apos;t have {formatAreaList(unsupported)} for this competition, so{" "}
          {unsupported.length === 1 ? "that section" : "those sections"} won&apos;t fill however long you wait.
          Whatever it does have appears above and in its own tab. The Room is open now.
        </p>
      ) : missingAreas.length > 0 ? (
        <p className="px-1 text-xs leading-relaxed text-foreground-muted">
          {waitingCopy} The Room is open now.
        </p>
      ) : null}
    </div>
  );
}
