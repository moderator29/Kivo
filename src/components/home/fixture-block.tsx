import { MatchList, MatchListRow, type MatchListFixture } from "@/components/matches/match-list";
import { CompetitionGroupHeader } from "@/components/matches/competition-group-header";
import { Section } from "@/components/ui/section";
import { SectionLink } from "@/components/home/section-action";
import { groupFixturesByCompetition } from "@/lib/football/group-by-competition";

/**
 * /home's fixture lists.
 *
 * There is exactly one match row in KIVO and it lives in
 * `src/components/matches/match-list.tsx` — the same row /matches, /live, a
 * team page and a venue page draw. Home renders it unchanged. Before the
 * frontend sweep this page had a third distinct match row of its own (teams
 * side by side, score squeezed between them, no time rail), which meant the
 * first screen after sign-in showed a match in a shape that appears nowhere
 * else in the product.
 *
 * What Home adds is only *arrangement*: which fixtures, under what heading,
 * and whether they are grouped by competition.
 */

/** The fields Home's fixture queries select, on top of the row's own. */
export type HomeFixture = MatchListFixture & {
  competition: { id: string | null; name: string; short_name: string | null; logo_url: string | null } | null;
};

/**
 * A flat list under one heading — the viewer's own clubs, their results, their
 * next kickoffs. Not grouped, and deliberately: three fixtures belonging to
 * three different competitions would become three headed groups of one row
 * each, which is more chrome than football.
 */
export function HomeFixtureSection({
  title,
  description,
  action,
  fixtures,
}: {
  title: string;
  description?: string | null;
  action?: { href: string; label: string };
  fixtures: MatchListFixture[];
}) {
  return (
    <Section
      title={title}
      description={description}
      action={action && <SectionLink href={action.href} label={action.label} />}
    >
      <MatchList>
        {fixtures.map((fixture) => (
          <MatchListRow key={fixture.id} fixture={fixture} />
        ))}
      </MatchList>
    </Section>
  );
}

/**
 * A list grouped into one surface per competition, with the competition's own
 * header above each — the shape /matches and /live use, because a card of
 * football is read competition by competition and always has been.
 *
 * Used where the list is genuinely a *card* of football rather than a handful
 * of rows: everything in play right now, and today's fixtures across KIVO.
 */
export function HomeCompetitionSection({
  title,
  description,
  action,
  fixtures,
  favouriteCompetitionIds,
}: {
  title: string;
  description?: string | null;
  action?: { href: string; label: string };
  fixtures: HomeFixture[];
  /** Competitions this viewer follows, so the star on each header shows its
   * real state rather than defaulting to unstarred. */
  favouriteCompetitionIds: Set<string>;
}) {
  const groups = groupFixturesByCompetition(fixtures);

  return (
    <Section
      title={title}
      description={description}
      action={action && <SectionLink href={action.href} label={action.label} />}
    >
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div key={group.competitionId ?? group.competitionName ?? "unnamed"} className="flex flex-col gap-1.5">
            <CompetitionGroupHeader
              competitionId={group.competitionId}
              competitionName={group.competitionName}
              country={null}
              logoUrl={group.fixtures[0]?.competition?.logo_url ?? null}
              fixtureCount={group.fixtures.length}
              isFavourite={group.competitionId ? favouriteCompetitionIds.has(group.competitionId) : false}
              signedIn
              density="compact"
            />
            <MatchList>
              {group.fixtures.map((fixture) => (
                <MatchListRow key={fixture.id} fixture={fixture} />
              ))}
            </MatchList>
          </div>
        ))}
      </div>
    </Section>
  );
}
