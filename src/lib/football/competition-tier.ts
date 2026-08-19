import type { CompetitionGroup } from "./group-by-competition";

/**
 * What order competitions appear in on the matches list, and where that order
 * comes from.
 *
 * ## The problem this solves
 *
 * `groupFixturesByCompetition` preserves first-appearance order, which is
 * kickoff order. On the live database that puts "III Liga - Group 2" and
 * "U19 Bundesliga" above the Champions League, because the third division
 * kicks off earlier in the day. The founder asked for Europe's top five
 * leagues first, then other major competitions, then the rest.
 *
 * ## What this deliberately is NOT
 *
 * A list of competition names ranked by whoever wrote the code. That is an
 * opinion compiled into the product: it cannot be checked by a reader, it is
 * wrong for anyone outside the countries the author happened to think of, and
 * it goes stale in silence. KIVO's launch market is Nigeria; a hand-ranked
 * European list would quietly bury the NPFL the day it is synced.
 *
 * ## The signals it uses instead
 *
 * Four, in strict priority order. Every one of them is a row that exists, or a
 * setting an operator has actually made.
 *
 * 1. **`favourite`** — the viewer's own `follows` rows with
 *    `followed_type = 'competition'`. The same table the star on the
 *    competition header writes to, and the same one /profile/following and the
 *    Copilot's grounding context read (see src/lib/follow-meaning.ts). A
 *    person's own choice outranks every inference KIVO could make.
 *
 * 2. **`covered`** — the competition is inside KIVO's configured coverage
 *    scope: `getCompetitionScope()` in src/lib/football/competitions-config.ts,
 *    which is `FOOTBALL_SYNC_COMPETITION_IDS` when set and a shipped default
 *    otherwise. Those are the provider's own league ids, matched against
 *    `provider_mappings` via `get_competition_provider_ids` (migration 0111).
 *
 *    This is the signal that produces "top five leagues, then other major
 *    competitions", and it produces it *without this file knowing what a top
 *    five league is*: the scope is an ordered list, and the order within this
 *    tier is the operator's own configured order. The shipped default is
 *    written as the five European domestic leagues followed by the continental
 *    cups, so that is what a default deployment shows — and an operator who
 *    adds the NPFL at the front gets the NPFL at the front, with no code
 *    change and nothing here to update.
 *
 * 3. **`followed`** — at least one KIVO profile follows this competition
 *    (`get_competition_follower_counts`, migration 0111), ranked by how many.
 *    Emergent rather than declared: a competition the operator never scoped
 *    but that KIVO's own users care about still climbs above the noise. This
 *    is the same "a real follower count is a legitimate popularity signal"
 *    reasoning `getPopularTeams` already uses, and like it, it is worth
 *    nothing until real people have used the product — which is honest.
 *    Until then this tier is simply empty.
 *
 * 4. **`other`** — everything else, in the order it already had (kickoff,
 *    ascending). No opinion is expressed about these at all.
 *
 * ## How it degrades right now
 *
 * The live database holds 85 competitions pulled from one day's fixtures and
 * `competitions.country` is null on every row, so the country signal does not
 * exist yet and is not used here. Under those conditions two of the four tiers
 * are empty and the list still improves: the two scoped competitions actually
 * present (La Liga, the Champions League) rise above the reserve and youth
 * divisions, and the rest keep kickoff order rather than being reshuffled by a
 * guess. Nothing here asserts that a competition is minor — it only ever
 * asserts that another one was deliberately chosen, which is a fact on record.
 */

export type CompetitionTier = "favourite" | "covered" | "followed" | "other";

/** Sort weight per tier. Lower sorts first. */
const TIER_ORDER: Record<CompetitionTier, number> = {
  favourite: 0,
  covered: 1,
  followed: 2,
  other: 3,
};

export type CompetitionRankingSignals = {
  /** The viewer's own followed competition ids. Empty for a guest. */
  favouriteCompetitionIds: ReadonlySet<string>;
  /**
   * The active provider's configured league ids, in the operator's own order.
   * `getCompetitionScope().orderedIds` — empty when the pipeline is
   * deliberately unfiltered, in which case the `covered` tier never applies
   * because "everything is in scope" ranks nothing above anything.
   */
  scopeProviderIds: readonly string[];
  /** KIVO competition id -> the active provider's league id for it. */
  providerIdByCompetitionId: ReadonlyMap<string, string>;
  /** KIVO competition id -> how many profiles follow it. Absent means zero. */
  followerCountByCompetitionId: ReadonlyMap<string, number>;
};

/**
 * The signals a caller that has none can pass. Ranking with this is a no-op:
 * every group lands in `other` and the original kickoff order survives intact.
 * Used by surfaces that render a fixture list without the two RPC round trips
 * (and by tests), so "no signals" degrades to today's behaviour rather than to
 * an arbitrary one.
 */
export const NO_COMPETITION_RANKING_SIGNALS: CompetitionRankingSignals = {
  favouriteCompetitionIds: new Set(),
  scopeProviderIds: [],
  providerIdByCompetitionId: new Map(),
  followerCountByCompetitionId: new Map(),
};

export type RankedCompetitionGroup<TFixture> = CompetitionGroup<TFixture> & {
  tier: CompetitionTier;
  /** Whether the viewer themselves has favourited this competition. */
  isFavourite: boolean;
  /** Position in the configured coverage scope, or null when outside it. */
  scopeIndex: number | null;
  /** Real count of profiles following it. Zero when nobody does. */
  followerCount: number;
};

/**
 * Assigns each group its tier, without reordering. Exported separately from
 * `rankCompetitionGroups` so a caller that wants the annotations but not the
 * sort (or a test) can have them.
 */
export function annotateCompetitionGroups<TFixture>(
  groups: CompetitionGroup<TFixture>[],
  signals: CompetitionRankingSignals,
): RankedCompetitionGroup<TFixture>[] {
  const scopeIndexByProviderId = new Map<string, number>();
  signals.scopeProviderIds.forEach((providerId, index) => {
    // First occurrence wins, so a duplicated id in a hand-written env var
    // ranks where it was first mentioned rather than where it was repeated.
    if (!scopeIndexByProviderId.has(providerId)) scopeIndexByProviderId.set(providerId, index);
  });

  return groups.map((group) => {
    const competitionId = group.competitionId;
    const providerId = competitionId ? signals.providerIdByCompetitionId.get(competitionId) : undefined;
    const scopeIndex = providerId !== undefined ? (scopeIndexByProviderId.get(providerId) ?? null) : null;
    const followerCount = competitionId ? (signals.followerCountByCompetitionId.get(competitionId) ?? 0) : 0;
    const isFavourite = competitionId ? signals.favouriteCompetitionIds.has(competitionId) : false;

    const tier: CompetitionTier = isFavourite
      ? "favourite"
      : scopeIndex !== null
        ? "covered"
        : followerCount > 0
          ? "followed"
          : "other";

    return { ...group, tier, isFavourite, scopeIndex, followerCount };
  });
}

/**
 * Groups in reading order: the viewer's favourites first, then KIVO's
 * configured coverage in the operator's order, then whatever KIVO's users
 * follow, then everything else in the kickoff order it already had.
 *
 * Stable: two groups with identical signals keep their original relative
 * order, so a re-render with no data change never reshuffles the page.
 */
export function rankCompetitionGroups<TFixture>(
  groups: CompetitionGroup<TFixture>[],
  signals: CompetitionRankingSignals,
): RankedCompetitionGroup<TFixture>[] {
  return annotateCompetitionGroups(groups, signals)
    .map((group, index) => ({ group, index }))
    .sort((a, b) => {
      const tierDelta = TIER_ORDER[a.group.tier] - TIER_ORDER[b.group.tier];
      if (tierDelta !== 0) return tierDelta;

      // Inside a tier, the same ladder applies again in the same order, so a
      // favourited Premier League sits above a favourited third division for
      // the same reason an unfavourited one would.
      if (a.group.scopeIndex !== b.group.scopeIndex) {
        if (a.group.scopeIndex === null) return 1;
        if (b.group.scopeIndex === null) return -1;
        return a.group.scopeIndex - b.group.scopeIndex;
      }

      if (a.group.followerCount !== b.group.followerCount) {
        return b.group.followerCount - a.group.followerCount;
      }

      return a.index - b.index;
    })
    .map(({ group }) => group);
}
