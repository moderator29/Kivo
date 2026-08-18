/**
 * The four ways to read /social.
 *
 * "All" and "Following" already existed. "Club mates" and "Rivals" are the
 * founder's ask, and both are answered from data KIVO genuinely holds:
 *
 *  - **Club mates** — posts by people whose `profiles.favourite_team_id` is the
 *    same as yours. That column has existed since migration 0001 and is set
 *    during onboarding; nothing is inferred.
 *  - **Rivals** — posts by people whose `favourite_team_id` is the club *you*
 *    named as your rival (`profiles.rival_team_id`, migration 0068). KIVO has
 *    no rivalry dataset and does not invent one: with no rival set, this feed
 *    honestly has nothing to show and says so, pointing at /settings/clubs.
 *
 * Both resolve to one query — "posts by supporters of club X" — which is why
 * `resolveFeedScope` returns a plain team id rather than two special cases.
 */
export const SOCIAL_FILTERS = ["all", "following", "clubmates", "rivals"] as const;

export type SocialFilter = (typeof SOCIAL_FILTERS)[number];

export const SOCIAL_FILTER_LABELS: Record<SocialFilter, string> = {
  all: "All",
  following: "Following",
  clubmates: "Club mates",
  rivals: "Rivals",
};

/** Parses the `?filter=` query value, defaulting to "all" for anything the
 * product does not recognise — a hand-edited URL should land on the feed, not
 * on an error. */
export function parseSocialFilter(value: string | undefined | null): SocialFilter {
  return (SOCIAL_FILTERS as readonly string[]).includes(value ?? "") ? (value as SocialFilter) : "all";
}

export function socialFilterHref(filter: SocialFilter): string {
  return filter === "all" ? "/social" : `/social?filter=${filter}`;
}

/**
 * Turns a filter plus the viewer's own two club columns into the scope
 * `fetchPostsPage` actually understands.
 *
 * `unavailable` is the honest third answer: a Club mates filter on a profile
 * with no club, or Rivals with no rival, is not an empty feed — it is a feed
 * that cannot be built yet, and the page says something different for each.
 */
export type FeedScope =
  | { kind: "all" }
  | { kind: "following" }
  | { kind: "team"; teamId: string }
  | { kind: "unavailable"; missing: "club" | "rival" };

export function resolveFeedScope(
  filter: SocialFilter,
  viewer: { favourite_team_id: string | null; rival_team_id: string | null } | null,
): FeedScope {
  switch (filter) {
    case "following":
      return { kind: "following" };
    case "clubmates":
      return viewer?.favourite_team_id
        ? { kind: "team", teamId: viewer.favourite_team_id }
        : { kind: "unavailable", missing: "club" };
    case "rivals":
      return viewer?.rival_team_id
        ? { kind: "team", teamId: viewer.rival_team_id }
        : { kind: "unavailable", missing: "rival" };
    default:
      return { kind: "all" };
  }
}
