/**
 * One place where every kind of football fact declares how long it stays true.
 *
 * `docs/CACHING_STRATEGY.md` was honest that this did not exist: what existed
 * was a set of per-endpoint `revalidate` constants, one per provider, each
 * chosen by a developer next to the fetch that used it, with no rule saying a
 * new endpoint had to pick from a defined set and no way to answer "what is the
 * TTL for standings" except by reading a provider file. Two providers had
 * separately-tuned numbers for conceptually identical data, and a third
 * provider would have made three.
 *
 * This is the thing that was missing. A resource CLASS is a kind of football
 * fact — a live match, a completed match, a league table, a club — and the class
 * owns its policy. An adapter names a class; it does not choose seconds.
 *
 * -----------------------------------------------------------------------------
 * WHY THE POLICY IS KEYED ON THE FACT AND NOT ON THE ENDPOINT
 * -----------------------------------------------------------------------------
 * Because the same endpoint serves facts with wildly different half-lives. One
 * `/fixtures` call returns a match kicking off in an hour, a match in its 70th
 * minute, and a match that finished in April. Cached per endpoint, all three get
 * whichever window the developer had in mind — which in practice means the
 * shortest, so KIVO re-fetches April every time it wants the 70th minute. The
 * classes below split that one endpoint into three policies precisely because
 * the difference between them is the whole saving.
 *
 * -----------------------------------------------------------------------------
 * TWO NUMBERS, NOT ONE
 * -----------------------------------------------------------------------------
 * `freshSeconds` is how long the answer is served with no question asked.
 * `staleSeconds` is how much longer it may still be served WHILE one caller
 * refreshes it in the background. The gap between them is the entire
 * stale-while-revalidate behaviour, and it is where the product survives a
 * provider outage: past `freshSeconds` KIVO wants a new answer, but until
 * `staleSeconds` it will show the old one rather than an empty screen.
 *
 * The stale window is deliberately WIDER for slow-moving facts than for fast
 * ones, which is the opposite of the instinct. A four-hour-old league table is
 * still a league table. A four-hour-old live score is a lie. So `live_match`
 * has almost no stale window and `competition` has an enormous one.
 *
 * -----------------------------------------------------------------------------
 * WHY THESE LIVE IN TYPESCRIPT AND THE BUDGET CEILINGS LIVE IN SQL
 * -----------------------------------------------------------------------------
 * A deliberate asymmetry, and the reason is what each number protects. A budget
 * ceiling bounds spending somebody else's money, so a caller that can choose its
 * own has no ceiling — it belongs where only a migration can change it
 * (migration 0094 argues this at length and it stands). A TTL is a claim about
 * how fast football changes: it is read by application code that must branch on
 * it, it wants to be unit-testable without a database, and a caller cannot abuse
 * it — the worst a wrong TTL does is waste a request or show something slightly
 * old. So the seconds live here and arrive at `write_provider_cache` as
 * arguments.
 */

/**
 * Every kind of football fact KIVO caches. Adding a case is how a new resource
 * gets a policy — the type makes it impossible to cache something that has not
 * declared one, which is the guardrail `CACHING_STRATEGY.md` said did not exist.
 */
export type ResourceClass =
  | "live_match"
  | "upcoming_match"
  | "completed_match"
  | "match_lineups"
  | "match_events"
  | "match_statistics"
  | "standings"
  | "team"
  | "squad"
  | "player"
  | "player_season_stats"
  | "competition"
  | "competition_coverage"
  | "transfers"
  | "injuries"
  | "top_scorers"
  | "provider_status";

/**
 * `catalogue` is the odd bucket out and migration 0107 explains why: it bounds
 * an admin-triggered path whose cost is one request PER CLUB. Mirrored here as a
 * type only — the ceilings themselves are the database's.
 */
export type RequestBucketName = "live" | "auto" | "daily" | "catalogue";

export interface ResourcePolicy {
  /** Served with no question asked for this long. */
  freshSeconds: number;
  /** Still servable for this long past the fetch, while one caller refreshes.
   * Always >= freshSeconds; the database refuses the alternative. */
  staleSeconds: number;
  /**
   * Which allowance a refresh of this class spends from. Null means this class
   * is never fetched by automation on its own account — an operator's explicit
   * action is the only thing that fetches it, and admin actions are deliberately
   * outside the automated allowances (migration 0094).
   */
  bucket: RequestBucketName | null;
  /**
   * True when a finished match makes this class wrong, regardless of its clock.
   * Standings are the case: a TTL is a guess about when a table might have
   * changed; a full-time whistle is proof that it did. The cache exposes
   * `invalidateOnMatchCompletion` for exactly these classes, so KIVO does not
   * have to shorten the TTL for the whole week to catch the few hours that
   * matter.
   */
  invalidatedByFinishedMatch: boolean;
  /** One sentence an admin screen can show next to the number, so a policy can
   * be judged without reading this file. */
  rationale: string;
}

/**
 * The policies. Every number below is a claim about football, and the rationale
 * beside it is the claim in words — if the two ever disagree, the words are what
 * somebody meant.
 *
 * The quota arithmetic these have to survive is unchanged: a free tier of order
 * a hundred requests a day, split into allowances by migration 0094. That is the
 * constraint that makes the long windows long rather than lazy.
 */
export const RESOURCE_POLICIES: Record<ResourceClass, ResourcePolicy> = {
  /**
   * The only class whose entire value is being current. Thirty seconds is not a
   * freshness target, it is a floor: the live worker's own derived pace decides
   * how often the feed is actually asked (`live-sync-planner.ts`), and this only
   * stops two callers in the same half-minute paying twice for one answer.
   *
   * The stale window is a single minute, and short on purpose. Everywhere else
   * in this file, old data is better than none; here it is worse. A score that
   * is four minutes behind is not a degraded live score, it is a wrong one, and
   * a fan who sees 1-0 after the equaliser has gone in has been misinformed
   * rather than merely underserved.
   */
  live_match: {
    freshSeconds: 30,
    staleSeconds: 60,
    bucket: "live",
    invalidatedByFinishedMatch: false,
    rationale: "A live score is only worth anything while it is current, so this is the one class where old data is worse than none.",
  },

  /**
   * A match that has not kicked off changes for exactly three reasons —
   * postponement, a venue change, a kickoff-time change — and all three are
   * hours-scale news, not minutes-scale. Ten minutes is far tighter than the
   * thing it describes and is chosen so a postponement announced during the
   * morning is on the product before anybody plans their afternoon around it.
   */
  upcoming_match: {
    freshSeconds: 600,
    staleSeconds: 3_600,
    bucket: "auto",
    invalidatedByFinishedMatch: false,
    rationale: "Fixtures move hours in advance, not minutes, so ten minutes is already far tighter than the thing it describes.",
  },

  /**
   * A finished match is history. The score will not change; at most a
   * disciplinary panel amends an event weeks later, which no TTL should be
   * designed around. Six hours of freshness with a two-day stale window means a
   * result page effectively never costs a request again after the day it was
   * played — which is where most of the saving in this entire file lives, since
   * completed matches outnumber live ones by orders of magnitude and are what
   * people browse.
   */
  completed_match: {
    freshSeconds: 21_600,
    staleSeconds: 172_800,
    bucket: "auto",
    invalidatedByFinishedMatch: false,
    rationale: "A result is history. Re-fetching it is the most wasteful request available, and completed matches are most of what anybody browses.",
  },

  /**
   * Lineups exist in two states and the cache cannot tell them apart from the
   * payload alone: the announced XI an hour before kickoff, and the same XI with
   * substitutions written into it afterwards. Two minutes serves both — short
   * enough that a substitution appears while people are watching, long enough
   * that a busy match room cannot turn one fixture into a quota incident.
   */
  match_lineups: {
    freshSeconds: 120,
    staleSeconds: 900,
    bucket: "live",
    invalidatedByFinishedMatch: false,
    rationale: "Substitutions land during the match, so this tracks the live clock; the stale window covers a provider blip mid-half.",
  },

  match_events: {
    freshSeconds: 120,
    staleSeconds: 900,
    bucket: "live",
    invalidatedByFinishedMatch: false,
    rationale: "Goals and cards arrive during play. Same window as lineups and statistics, deliberately, so a match room cannot show three views of the same match that disagree.",
  },

  match_statistics: {
    freshSeconds: 120,
    staleSeconds: 900,
    bucket: "live",
    invalidatedByFinishedMatch: false,
    rationale: "Moves on the same clock as events; kept identical so a possession figure never contradicts the goal beside it.",
  },

  /**
   * The class the event-driven invalidation exists for.
   *
   * A league table is stable for days and then changes in ninety minutes. An
   * hourly TTL spends roughly twenty-four requests a day to catch the two or
   * three occasions a week when it mattered; a daily TTL is cheap and shows a
   * table that is wrong for most of Saturday evening. Neither is a good trade.
   *
   * So the clock is set long — six hours — and a finished match expires it
   * outright. The table is refreshed because something changed it, not because a
   * timer went off.
   */
  standings: {
    freshSeconds: 21_600,
    staleSeconds: 172_800,
    bucket: "daily",
    invalidatedByFinishedMatch: true,
    rationale: "A table changes when a match finishes, not when a clock ticks — so a full-time whistle expires it and the clock is only the backstop.",
  },

  team: {
    freshSeconds: 604_800,
    staleSeconds: 2_592_000,
    bucket: "catalogue",
    invalidatedByFinishedMatch: false,
    rationale: "A club's name, crest and ground change on the scale of seasons. A week is already far shorter than the thing it describes.",
  },

  /**
   * A squad changes on two transfer windows a year and, within a season, on the
   * occasional free agent. A day was the old constant and it is kept: longer
   * risks a January signing staying invisible for a week, which is the kind of
   * gap a fan notices immediately and cannot explain.
   */
  squad: {
    freshSeconds: 86_400,
    staleSeconds: 604_800,
    bucket: "catalogue",
    invalidatedByFinishedMatch: false,
    rationale: "Windows move squads twice a year, but a mid-season signing must not stay invisible for a week — so a day, not longer.",
  },

  player: {
    freshSeconds: 604_800,
    staleSeconds: 2_592_000,
    bucket: "catalogue",
    invalidatedByFinishedMatch: false,
    rationale: "A player's name, photo and date of birth are effectively fixed; only the club moves, and the squad class already tracks that.",
  },

  /**
   * Season aggregates advance at most once per matchday, so a six-hour window
   * cannot miss anything a fan could have seen. Deliberately NOT invalidated by
   * a finished match, unlike standings: a table is a small object shared by
   * twenty clubs, while season stats are one object per player, and expiring
   * every player in a league because one match ended would turn a saving into a
   * stampede.
   */
  player_season_stats: {
    freshSeconds: 21_600,
    staleSeconds: 259_200,
    bucket: "daily",
    invalidatedByFinishedMatch: false,
    rationale: "Advances once a matchday at most. Not expired by a finished match on purpose — that would re-fetch every player in the league at once.",
  },

  competition: {
    freshSeconds: 604_800,
    staleSeconds: 2_592_000,
    bucket: "daily",
    invalidatedByFinishedMatch: false,
    rationale: "A competition's identity changes between seasons, not within one.",
  },

  /**
   * What a provider's plan can serve changes when a season rolls over, and the
   * response is large — every league the plan can see. Re-fetching it often is
   * the single most wasteful call available on any of these APIs.
   */
  competition_coverage: {
    freshSeconds: 604_800,
    staleSeconds: 2_592_000,
    bucket: "daily",
    invalidatedByFinishedMatch: false,
    rationale: "The largest response any of these providers serves, describing something that changes once a season.",
  },

  transfers: {
    freshSeconds: 172_800,
    staleSeconds: 604_800,
    bucket: "catalogue",
    invalidatedByFinishedMatch: false,
    rationale: "Transfer history is append-only and already historical fact — revisiting a player's profile must never buy it again.",
  },

  /**
   * The one slow-moving class that genuinely moves within a day: a squad
   * announcement can flip a player from doubt to available hours before kickoff.
   * Six hours is the compromise between that and its cost, which is one request
   * per competition on a hundred-request budget.
   */
  injuries: {
    freshSeconds: 21_600,
    staleSeconds: 86_400,
    bucket: "daily",
    invalidatedByFinishedMatch: false,
    rationale: "Genuinely changes within a day, but a six-hour-old injury report has never misled anybody.",
  },

  top_scorers: {
    freshSeconds: 21_600,
    staleSeconds: 259_200,
    bucket: "daily",
    invalidatedByFinishedMatch: false,
    rationale: "A scoring chart only moves when matches are played, and never by much in one of them.",
  },

  /**
   * The account/plan probe. Its answer changes on every other request KIVO
   * makes, since it carries today's spend — so a long window would make it lie
   * about the number that matters most on the page it exists for. Five minutes
   * is short enough to be useful to somebody watching an admin screen and long
   * enough that refreshing that screen does not itself become the thing eating
   * the quota. No stale window at all: a stale quota reading is worse than an
   * absent one, because a number on a screen gets believed.
   */
  provider_status: {
    freshSeconds: 300,
    staleSeconds: 300,
    bucket: null,
    invalidatedByFinishedMatch: false,
    rationale: "Carries today's spend, so it must never be shown stale — a wrong quota number gets believed and acted on.",
  },
};

/** The policy for a class. A plain lookup, exported as a function so call sites
 * read as a question rather than as an index into a table. */
export function resourcePolicy(resourceClass: ResourceClass): ResourcePolicy {
  return RESOURCE_POLICIES[resourceClass];
}

/** Every class a finished match invalidates. Read by the cache's
 * `invalidateOnMatchCompletion`, so adding `invalidatedByFinishedMatch: true`
 * to a class is the only thing needed to enrol it. */
export function classesInvalidatedByFinishedMatch(): ResourceClass[] {
  return (Object.keys(RESOURCE_POLICIES) as ResourceClass[]).filter(
    (name) => RESOURCE_POLICIES[name].invalidatedByFinishedMatch,
  );
}

/**
 * Which match class a fixture belongs to, from its status.
 *
 * The function that makes the three-way split at the top of this file real. It
 * takes the status string rather than a fixture object so it stays a pure
 * function of one value, testable and free of any dependency on KIVO's fixture
 * shape.
 *
 * An unrecognised status resolves to `upcoming_match`, which is the
 * conservative direction: the shortest of the two non-live windows, so an
 * unknown status is refreshed sooner rather than being frozen for two days.
 */
export function matchResourceClass(status: string | null | undefined): ResourceClass {
  const normalized = (status ?? "").trim().toLowerCase();
  if (normalized === "live" || normalized === "halftime" || normalized === "in_play" || normalized === "paused") {
    return "live_match";
  }
  if (
    normalized === "finished" ||
    normalized === "full_time" ||
    normalized === "awarded" ||
    normalized === "cancelled" ||
    normalized === "abandoned"
  ) {
    return "completed_match";
  }
  return "upcoming_match";
}
