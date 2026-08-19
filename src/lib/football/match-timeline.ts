/**
 * Pure decisions the Match Centre's Timeline tab makes about events, kept out
 * of the component so they can be tested without a DOM, a Supabase client or a
 * Realtime channel — and so the tab and the Realtime hook that feeds it cannot
 * drift apart by each holding its own copy.
 *
 * Both of these looked too small to extract right up until they were wrong in
 * two places at once: an ordering that disagrees with the server's puts a live
 * goal in a different spot than it occupies after the next navigation, and a
 * side resolution that throws on an unrecognised team silently loses a real
 * event KIVO stored.
 */

/** The minimum an event needs to be placed in order. Structural on purpose:
 * the component's `MatchEvent` and the raw `fixture_events` row both satisfy
 * it, so neither has to be converted before it can be sorted. */
export type OrderableEvent = { id: string; minute: number; addedTime: number | null };

/**
 * Match order has to be identical to the server's
 * (`order("minute", { ascending: true })` in the fixture page) or an event that
 * arrives over Realtime lands in one place now and a different place after the
 * next server render — which reads, correctly, as the timeline rearranging
 * itself for no reason.
 *
 * `addedTime` breaks the tie inside a minute, so 90+4 follows 90 rather than
 * sorting arbitrarily against it. The id breaks a remaining tie: arbitrary, but
 * stable, which is the property that actually matters — two events genuinely
 * stamped the same minute and added time never swap places between renders.
 */
export function compareTimelineEvents(a: OrderableEvent, b: OrderableEvent): number {
  if (a.minute !== b.minute) return a.minute - b.minute;
  const aAdded = a.addedTime ?? 0;
  const bAdded = b.addedTime ?? 0;
  if (aAdded !== bAdded) return aAdded - bAdded;
  return a.id.localeCompare(b.id);
}

/** Which side of the timeline's centre spine an event belongs on. */
export type EventSide = "home" | "away" | null;

/**
 * `null` is not an error path to be tightened up later — it is the answer for
 * an event whose `team_id` matches neither club on the fixture, which happens
 * for real: a club merged mid-season (see the admin team-merge tool), a
 * provider id re-keyed between syncs. The Timeline renders those centred and
 * unattributed rather than dropping them, because a real event KIVO stored
 * should stay visible even when its side cannot be resolved.
 *
 * An empty `teamId` resolves to null rather than accidentally matching an
 * empty `homeTeamId` — the fixture page passes `""` when a fixture's team
 * didn't resolve, and two unknowns are not a match.
 */
export function resolveEventSide(teamId: string, homeTeamId: string, awayTeamId: string): EventSide {
  if (!teamId) return null;
  if (teamId === homeTeamId) return "home";
  if (teamId === awayTeamId) return "away";
  return null;
}

/**
 * Pick the active tab from a URL slug, honouring slugs that used to name a tab
 * and still appear in links people have shared or bookmarked.
 *
 * Generic over the tab type so it stays in this pure module rather than in the
 * client component: the caller supplies its own tab union and its own legacy
 * map, and gets back one of the tabs it passed in.
 *
 * Falls back to the *first visible* tab rather than a fixed one, because the
 * Match Centre collapses its data tabs when none of them hold anything — so
 * `?tab=stats` can name a tab that isn't on screen, and landing on a tab the
 * strip doesn't show would leave nothing highlighted.
 */
export function resolveTabFromSlug<T extends string>(
  slug: string | null,
  visible: readonly T[],
  toSlug: (tab: T) => string,
  legacy: Readonly<Record<string, T>> = {},
): T {
  const direct = visible.find((tab) => toSlug(tab) === slug);
  if (direct) return direct;
  const renamed = slug ? legacy[slug] : undefined;
  if (renamed && visible.includes(renamed)) return renamed;
  return visible[0];
}
