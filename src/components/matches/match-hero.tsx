import Image from "next/image";
import Link from "next/link";
import { CalendarClock, MapPin } from "lucide-react";
import { MatchScoreDisplay } from "@/components/matches/match-score-display";
import { TeamCrest } from "@/components/ui/team-crest";
import { LocalDateTime } from "@/components/ui/relative-time";
import { LastUpdatedNote } from "@/components/football/last-updated-note";
import { AskAiLink } from "@/components/ai/ask-ai-link";
import { SHARE_BACKGROUND_LAYERS } from "@/lib/share-cards/backgrounds";
import type { FixtureStatus } from "@/lib/football/fixture-status";

/**
 * The one thing a fan came for, before anything else on the page.
 *
 * ## What it replaces
 *
 * A header card that had accumulated: a competition line, a freshness line,
 * two crests, two club names, two manager names, a score, a status pill and an
 * AI link — then, *below* it and before the tab strip, a prediction card, a
 * rating card, a verdict card and three share surfaces. On a phone the tab
 * strip — the control that reaches the line-ups, the timeline, the table —
 * began somewhere around the fourth screenful. The founder's word for the
 * result was blunt and correct.
 *
 * The rule now is the one every match page a fan already trusts follows: the
 * score, then the sections, then everything else. So this holds the fixture's
 * identity and nothing that is not part of it, and the tab rail sits directly
 * underneath it. Every card that used to be stacked between them is still in
 * the product — it moved into the section it belongs to, which is Overview.
 *
 * ## The managers moved out
 *
 * They were under each crest, in 11px, in the most valuable block on the
 * screen. A manager is a fact about the team sheet, and the Lineups tab names
 * them beside the eleven they picked, which is where they are actually read.
 *
 * ## The club names became links
 *
 * They had never been. The two most obvious nouns on the page pointed nowhere,
 * on a platform with a club page for both of them.
 *
 * ## The backdrop
 *
 * The viewer's OWN chosen background — the same `profiles.background_id` or
 * upload that drives their profile cover and the share cards further down this
 * page. That is the founder's "make it editable from background ones", and it
 * was already wired here before this rebuild; it survives it unchanged. Null
 * for a viewer who has chosen nothing, and the banner then falls back to
 * exactly the fixed gradient it has always had.
 *
 * The scrim is not decoration. The KIVO covers are busy renders and a
 * scoreline straight onto one is illegible; this is the same layer, and the
 * same reasoning, that the share cards apply.
 */
export type MatchHeroTeam = {
  id: string | null;
  name: string;
  crestUrl: string | null;
};

export function MatchHero({
  fixtureId,
  home,
  away,
  status,
  homeScore,
  awayScore,
  minuteElapsed,
  kickoffAt,
  competitionLabel,
  roundLabel,
  venue,
  bannerSrc,
  lastUpdatedAt,
}: {
  fixtureId: string;
  home: MatchHeroTeam;
  away: MatchHeroTeam;
  status: FixtureStatus;
  homeScore: number | null;
  awayScore: number | null;
  minuteElapsed: number | null;
  kickoffAt: string;
  competitionLabel: string | null;
  /** "Matchday 12", "Quarter-finals" — the round as the competition names it,
   * or null for a fixture with no round on record. */
  roundLabel: string | null;
  venue: { id: string; name: string; city: string | null } | null;
  /** The viewer's own chosen cover, or null. */
  bannerSrc: string | null;
  lastUpdatedAt: string | null;
}) {
  return (
    <section
      className={`relative flex flex-col gap-4 overflow-hidden rounded-3xl p-4 sm:p-6 ${
        bannerSrc ? "border border-hairline bg-surface-1" : "kivo-glass-brand"
      }`}
      aria-label={`${home.name} against ${away.name}`}
    >
      {bannerSrc && (
        <>
          <Image
            src={bannerSrc}
            alt=""
            aria-hidden="true"
            fill
            sizes="(max-width: 672px) 100vw, 672px"
            className="pointer-events-none -z-10 object-cover"
            priority={false}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10"
            style={{ background: SHARE_BACKGROUND_LAYERS.scrim }}
          />
        </>
      )}

      {/* Match-centre-only keyframes: a breathing live badge, an expanding
          "on air" ring on its dot, and a brief scale-in for the score on load.
          Scoped here rather than in globals.css since this page is the only
          place they are used; the sitewide prefers-reduced-motion block in
          globals.css already clamps them, same as kivo-aurora. */}
      <style>{`
        @keyframes kivo-live-breathe {
          0%, 100% { opacity: 0.88; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.04); }
        }
        @keyframes kivo-live-ring {
          0% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--kivo-live) 45%, transparent); }
          70% { box-shadow: 0 0 0 7px color-mix(in oklab, var(--kivo-live) 0%, transparent); }
          100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--kivo-live) 0%, transparent); }
        }
        @keyframes kivo-score-reveal {
          0% { opacity: 0; transform: scale(0.82); }
          100% { opacity: 1; transform: scale(1); }
        }
        /* A goal and a routine correction used to fire the same reveal.
           MatchScoreDisplay plays this one only on a real, detected score
           increase, reusing kivo-gradient-victory as a brief glow behind the
           score so an actual goal gets a visibly bigger moment. */
        @keyframes kivo-goal-glow {
          0% { opacity: 0; transform: scale(0.85); }
          30% { opacity: 0.55; transform: scale(1.08); }
          100% { opacity: 0; transform: scale(1); }
        }
      `}</style>

      {(competitionLabel || roundLabel || lastUpdatedAt) && (
        <div className="flex items-center justify-between gap-3 text-[11px] text-foreground-subtle">
          <span className="min-w-0 truncate font-semibold uppercase tracking-wide">
            {competitionLabel}
            {competitionLabel && roundLabel ? " · " : ""}
            {roundLabel}
          </span>
          <LastUpdatedNote timestamp={lastUpdatedAt} />
        </div>
      )}

      {/* The fixed centre column is what keeps the scoreline optically centred
          whatever the two club names do — with three 1fr tracks a long name on
          one side pushes the score off-axis, which is the small wrongness that
          makes a header feel homemade. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 sm:gap-4">
        <HeroTeam team={home} />
        <div className="flex min-w-[5.5rem] justify-center pt-1 sm:min-w-[7rem]">
          <MatchScoreDisplay
            fixtureId={fixtureId}
            status={status}
            homeScore={homeScore}
            awayScore={awayScore}
            minuteElapsed={minuteElapsed}
            kickoffAt={kickoffAt}
          />
        </div>
        <HeroTeam team={away} />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-foreground-subtle">
        {/* Before kick-off the status pill IS the kick-off time, so repeating
            it here put the same clock on screen twice, eight pixels apart.
            Once the match is under way the pill reads "FT" or a minute, and
            the date becomes a fact again rather than an echo. */}
        {status !== "scheduled" && (
          <span className="flex items-center gap-1">
            <CalendarClock className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
            <LocalDateTime iso={kickoffAt} format="deadline" />
          </span>
        )}
        {venue?.name && (
          <Link
            href={`/venues/${venue.id}`}
            className="flex min-h-[1.75rem] items-center gap-1 transition hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <MapPin className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
            <span className="truncate">
              {venue.name}
              {venue.city ? `, ${venue.city}` : ""}
            </span>
          </Link>
        )}
      </div>

      <div className="flex justify-center">
        <AskAiLink ctx="fixture" id={fixtureId} label="Ask AI about this match" />
      </div>
    </section>
  );
}

/**
 * One club in the hero. The whole block is the tap target — crest and name
 * together clear 44px comfortably at every width, which a bare 11px name
 * underneath a crest never did.
 */
function HeroTeam({ team }: { team: MatchHeroTeam }) {
  const inner = (
    <>
      <TeamCrest crestUrl={team.crestUrl} name={team.name} size={48} />
      <span className="line-clamp-2 text-center text-[13px] font-semibold leading-tight text-foreground sm:text-sm">
        {team.name}
      </span>
    </>
  );

  const className =
    "flex min-w-0 flex-col items-center gap-2 rounded-2xl px-1 py-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

  if (!team.id) return <div className={className}>{inner}</div>;

  return (
    <Link href={`/teams/${team.id}`} className={`${className} hover:bg-foreground/5`}>
      {inner}
    </Link>
  );
}
