import type { HomeLead } from "@/lib/home-lead";

/**
 * What /home shows below the lead slot, and — the part that matters — in what
 * order for *this* reader.
 *
 * `home-lead.ts` already answers "what is the single most important thing
 * right now" and hands back a lead with a `reason`. This module is the same
 * idea applied to the rest of the page: every section is a candidate, a
 * section only becomes a candidate when it has something real in it, and the
 * order is derived from facts about the viewer rather than from the order the
 * JSX happens to be written in.
 *
 * That distinction is the whole point. A page that renders the same twelve
 * cards in the same order for everybody is a dashboard. A command centre puts
 * the thing you can act on now at the top and pushes the browsing surfaces
 * down, and it tells you why it did — every section carries a `reason` for
 * the same reason the lead does (RECOMMENDATIONS.md item 256: no hidden
 * scoring, no unexplained "for you" ranking; a reader of this file can
 * predict exactly what any given user sees).
 *
 * Design rules, all three load-bearing:
 *
 * 1. **Pure.** No Supabase, no React, no clock of its own — `now` is passed
 *    in, same contract as `selectHomeLead`, so the whole page shares one
 *    clock and the ladder is unit-testable rather than eyeballed.
 * 2. **Absent, not empty.** A section with nothing real in it is not in the
 *    returned list at all. There is no "0 predictions" tile, no fantasy rank
 *    for someone with no team, no "recently viewed" on a first session. This
 *    is the same line the share cards hold: an unknown is omitted, and only a
 *    genuinely-counted zero is ever printed.
 * 3. **Tiers, not a formula.** Priorities are named constants with gaps, not
 *    a weighted score. "Why is this third" always has an answer you can read.
 */
export type HomeSectionId =
  | "briefing"
  | "notifications"
  | "clubs_today"
  | "live_now"
  | "results"
  | "fantasy"
  | "predictions"
  | "trending_rooms"
  | "feed"
  | "transfer_pulse"
  | "your_players"
  | "your_competitions"
  | "top_matches"
  | "no_football_yet"
  | "upcoming"
  | "recently_viewed";

export type HomeSection = {
  id: HomeSectionId;
  /**
   * Why this section is here. Kept on every section because the ladder is
   * meant to be readable, but **rendered only where it states a fact the
   * heading does not already carry** — see `HomeSection`'s module doc. An
   * explanation under all thirteen headings is a large part of what made this
   * page read as generated rather than designed.
   */
  reason: string;
  priority: number;
};

/**
 * The tiers. Read these as sentences about the reader, not as numbers:
 *
 *   NOW      — happening or locking within hours; acting later means missing it.
 *   SOON     — today's business; worth planning around.
 *   PERSONAL — about this reader, but nothing expires.
 *   CONTEXT  — real, relevant, not urgent.
 *   BROWSE   — somewhere to go next.
 *
 * Gaps of 100 leave room for a section to sit between two tiers without a
 * renumbering, and the small offsets inside a tier are the tie-break order.
 */
export const TIER = {
  NOW: 100,
  SOON: 200,
  PERSONAL: 300,
  CONTEXT: 400,
  BROWSE: 500,
} as const;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A deadline inside this window is the reader's most pressing fantasy fact. */
export const FANTASY_URGENT_MS = DAY_MS;
/** A prediction locking inside this window can still be changed, but not for long. */
export const PREDICTION_URGENT_MS = 6 * HOUR_MS;
/** How recent a transfer has to be to count as "pulse" rather than history. */
export const TRANSFER_PULSE_MS = 3 * DAY_MS;
/**
 * How recently a followed club has to have finished for the result to be news.
 *
 * Eighteen hours, chosen against the reader rather than against the clock: it
 * covers "I went to bed before full time" for every European evening kickoff,
 * and it has expired by the following evening, so a Wednesday night result is
 * not still being announced on Thursday night. This is the Tuesday-morning
 * half of the page — the single thing the previous build had no answer for,
 * because it showed fixtures ahead and never a result behind.
 */
export const RESULT_FRESH_MS = 18 * HOUR_MS;

export type HomeSectionFacts = {
  /** One clock for the whole render, injected — see the module doc. */
  now: number;
  /** What the lead slot is already showing, so a section can stand down
   * rather than repeat it. */
  lead: HomeLead;
  /** How many real lines the briefing found. Zero means no briefing card. */
  briefingLineCount: number;
  /** Unread notifications for this viewer, already filtered by blocks and
   * quiet hours upstream. */
  unreadNotificationCount: number;
  /** Followed clubs with a fixture today, excluding whatever leads. */
  clubsTodayCount: number;
  /** Whether one of those is being played right now. */
  hasLiveFollowedFixture: boolean;
  /** Matches in play across KIVO that are NOT one of this viewer's own — the
   * rest of the live card. Zero on a Tuesday morning, which is exactly when
   * this section should not exist. */
  liveElsewhereCount: number;
  /** Finished fixtures for followed clubs, most recent first. `latestAt` is
   * the kickoff of the most recent one, which is what decides whether these
   * are news or history. */
  recentResults: { count: number; latestAt: string | null };
  /** Null unless the viewer actually has a fantasy team. `latestPoints` is
   * null until a gameweek has genuinely been scored — never 0 as a stand-in
   * for "not calculated yet". */
  fantasy: {
    deadlineAt: string | null;
    rosterConfirmed: boolean;
    latestPoints: number | null;
    rank: number | null;
  } | null;
  /** Null unless the viewer has made at least one prediction ever. */
  predictions: {
    openCount: number;
    nextLockAt: string | null;
    currentStreak: number;
  } | null;
  /** The busiest Match Room KIVO can see today, or null when no Room has
   * anybody in it. A Room with one participant is not trending. */
  trendingRoom: { participantCount: number; involvesFollowedClub: boolean } | null;
  /** Posts from the people this viewer follows. Zero means no section — KIVO
   * does not fill a personalised feed with strangers and call it personal. */
  feedPostCount: number;
  /** Completed moves involving a club or player this viewer follows. */
  transferPulse: { count: number; latestAt: string | null };
  followedPlayerCount: number;
  followedCompetitionCount: number;
  /** Fixtures on today's card across KIVO, after the viewer's own are removed. */
  topMatchCount: number;
  /** Future fixtures for followed clubs, after the lead is removed. */
  upcomingCount: number;
  /** Whether the AI Copilot is actually configured in this environment. Home
   * has to agree with the navigation, which marks AI "Coming Soon" until the
   * key is present — so the Copilot line inside the briefing is gated on
   * exactly the same boolean rather than on a second guess at it. */
  aiConfigured: boolean;
};

function within(now: number, iso: string | null, windowMs: number): boolean {
  if (!iso) return false;
  const delta = new Date(iso).getTime() - now;
  return delta > 0 && delta <= windowMs;
}

function elapsedWithin(now: number, iso: string | null, windowMs: number): boolean {
  if (!iso) return false;
  const delta = now - new Date(iso).getTime();
  return delta >= 0 && delta <= windowMs;
}

/**
 * The ladder. Every branch below is "does this reader have a real reason to
 * see this, and how pressing is it" — nothing here invents a reason.
 *
 * The two questions it is built to answer correctly are the founder's own:
 * *what does a fan want in the first screenful at 3pm on a Saturday, and what
 * do they want on a Tuesday morning?*
 *
 *   3pm Saturday — a followed club in play leads, the rest of the live card
 *   follows it, then the rest of today. Results and standings-shaped browsing
 *   fall below the fold, because none of it is happening now.
 *
 *   Tuesday morning — nothing is live, so `live_now` and `clubs_today` do not
 *   exist at all, and the top of the page becomes last night's result, then
 *   what happened while they were away, then the next kickoff. That is a
 *   genuinely different page from the same rules, which is the point.
 */
export function selectHomeSections(facts: HomeSectionFacts): HomeSection[] {
  const sections: HomeSection[] = [];
  const add = (id: HomeSectionId, priority: number, reason: string) => sections.push({ id, priority, reason });

  const followsSomething =
    facts.clubsTodayCount > 0 ||
    facts.upcomingCount > 0 ||
    facts.recentResults.count > 0 ||
    facts.followedPlayerCount > 0 ||
    facts.followedCompetitionCount > 0;

  // The briefing is the summary of everything below it, so it sits above
  // everything below it. It only exists when it found real lines.
  if (facts.briefingLineCount > 0) {
    add("briefing", 0, "Everything KIVO knows about your day, in one place");
  }

  if (facts.clubsTodayCount > 0) {
    add(
      "clubs_today",
      facts.hasLiveFollowedFixture ? TIER.NOW : TIER.SOON,
      facts.hasLiveFollowedFixture ? "Your clubs are playing right now" : "Your clubs play today",
    );
  }

  // The rest of the live card, directly under the viewer's own. At 3pm on a
  // Saturday this is the second thing a fan wants and the previous build had
  // no equivalent of it — live football reached /home only if one of *their*
  // clubs happened to be playing.
  if (facts.liveElsewhereCount > 0) {
    add("live_now", TIER.NOW + 10, "Matches in play across KIVO right now");
  }

  // A result they have not seen yet. Above notifications, because a
  // notification about a goal is a worse way to learn a score than the score.
  if (facts.recentResults.count > 0) {
    const isFresh = elapsedWithin(facts.now, facts.recentResults.latestAt, RESULT_FRESH_MS);
    add(
      "results",
      isFresh ? (facts.hasLiveFollowedFixture ? TIER.SOON + 15 : TIER.NOW + 15) : TIER.CONTEXT + 5,
      isFresh ? "How your clubs got on" : "Your clubs' recent results",
    );
  }

  // Something already happened that concerns this reader personally. It
  // outranks browsing, but never outranks a match being played right now —
  // the notification will still be there in ninety minutes.
  if (facts.unreadNotificationCount > 0) {
    add(
      "notifications",
      facts.hasLiveFollowedFixture ? TIER.SOON + 5 : TIER.NOW + 20,
      facts.unreadNotificationCount === 1 ? "One thing happened while you were away" : `${facts.unreadNotificationCount} things happened while you were away`,
    );
  }

  if (facts.fantasy) {
    const deadlineIsUrgent = within(facts.now, facts.fantasy.deadlineAt, FANTASY_URGENT_MS);
    if (deadlineIsUrgent && !facts.fantasy.rosterConfirmed) {
      // The one fantasy state that costs the reader something if they scroll
      // past it. The lead may already be shouting about it, in which case
      // this section stands down to a normal personal card.
      add(
        "fantasy",
        facts.lead.kind === "fantasy_deadline" ? TIER.PERSONAL : TIER.NOW + 30,
        "Your squad isn't confirmed and the deadline is close",
      );
    } else if (deadlineIsUrgent) {
      add("fantasy", TIER.SOON + 10, "Your gameweek locks soon");
    } else if (facts.fantasy.latestPoints !== null) {
      add("fantasy", TIER.PERSONAL, "How your last scored gameweek went");
    } else {
      // A team with no scored gameweek and no near deadline is real, but it
      // is not news. It stays on the page so the reader can get back to it.
      add("fantasy", TIER.CONTEXT, "You're in a fantasy league");
    }
  }

  if (facts.predictions) {
    const locksSoon = within(facts.now, facts.predictions.nextLockAt, PREDICTION_URGENT_MS);
    if (facts.predictions.openCount > 0 && locksSoon) {
      add(
        "predictions",
        facts.lead.kind === "open_predictions" ? TIER.PERSONAL + 10 : TIER.NOW + 40,
        "A call you've made locks within hours",
      );
    } else if (facts.predictions.openCount > 0) {
      add("predictions", TIER.SOON + 20, "Calls you've made that haven't locked yet");
    } else if (facts.predictions.currentStreak > 0) {
      // A streak is worth showing on its own — but only a real one. A streak
      // of zero produces no section rather than a card reading "0".
      add("predictions", TIER.PERSONAL + 10, "You're on a run");
    }
  }

  if (facts.trendingRoom) {
    add(
      "trending_rooms",
      facts.trendingRoom.involvesFollowedClub ? TIER.SOON + 30 : TIER.CONTEXT + 10,
      facts.trendingRoom.involvesFollowedClub
        ? "One of your clubs has the busiest Room on KIVO"
        : "The busiest Match Rooms on KIVO right now",
    );
  }

  if (facts.transferPulse.count > 0) {
    const isRecent = elapsedWithin(facts.now, facts.transferPulse.latestAt, TRANSFER_PULSE_MS);
    add(
      "transfer_pulse",
      isRecent ? TIER.SOON + 40 : TIER.CONTEXT + 20,
      isRecent ? "A club or player you follow just moved someone" : "Recorded moves involving who you follow",
    );
  }

  // The personalised half of the feed: posts by people this viewer chose to
  // follow. The previous build had a "Community" card in this slot carrying a
  // fixed paragraph of promotional copy and no data at all — a section that
  // was on the page whether or not anybody had posted.
  if (facts.feedPostCount > 0) {
    add("feed", TIER.PERSONAL + 15, "From the people you follow");
  }

  if (facts.followedPlayerCount > 0) {
    add("your_players", TIER.PERSONAL + 20, "The players you follow");
  }

  if (facts.topMatchCount > 0) {
    // For somebody who follows nothing yet, today's card is not context — it
    // is the entire football on the page, and it goes straight under the lead.
    // This is the ladder doing the founder's "personalisation should visibly
    // improve as the user follows things" from the other end: follow nothing
    // and KIVO still opens on real football.
    add("top_matches", followsSomething ? TIER.CONTEXT + 30 : TIER.NOW + 60, "The rest of today's football on KIVO");
  } else if (!followsSomething) {
    // The single highest-traffic empty state in the product: a brand-new
    // account, before any football has been synced. It takes the slot
    // top_matches would have had — the two are mutually exclusive — and it
    // says what is actually true rather than pretending the page is finished.
    add("no_football_yet", TIER.NOW + 60, "Nothing is on today's card yet");
  }

  if (facts.upcomingCount > 0) {
    // On a quiet day the next kickoff is the only football the viewer's own
    // clubs have on this page, so it stops being a browsing surface.
    const quiet = facts.clubsTodayCount === 0 && !facts.hasLiveFollowedFixture;
    add("upcoming", quiet ? TIER.CONTEXT + 15 : TIER.BROWSE, "Next up for your clubs");
  }

  if (facts.followedCompetitionCount > 0) {
    add("your_competitions", TIER.BROWSE + 5, "Competitions you follow");
  }

  // Recently viewed lives in localStorage, so only the browser knows whether
  // there is anything in it — the component renders nothing when there isn't
  // (see recently-viewed-strip.tsx). It is listed unconditionally here and
  // disappears on its own, which is the one honest way to place a section
  // whose contents the server genuinely cannot see.
  add("recently_viewed", TIER.BROWSE + 10, "Where you left off");

  // Stable sort: equal priorities keep insertion order, so the tie-break is
  // the order written above rather than whatever the engine feels like.
  return sections.sort((a, b) => a.priority - b.priority);
}

export type QuickAction = {
  id: string;
  label: string;
  href: string;
  /**
   * A real count riding on the action, or null.
   *
   * This used to be a sentence of explanation under every shortcut ("KIVO
   * builds this page around who you follow"), rendered as a four-up grid of
   * bordered tiles — a second navigation bar wearing cards. The row is now a
   * rail of pills, and a pill either carries a number KIVO actually counted or
   * carries nothing. There is no third option where it carries prose.
   */
  hint: string | null;
};

/** How many shortcuts a phone can show without the row becoming a menu. */
export const MAX_QUICK_ACTIONS = 4;

/**
 * The quick-actions row, chosen the same way the sections are: an action is
 * offered because a real fact makes it useful right now, and the most
 * time-sensitive one comes first.
 *
 * Deliberately not a fixed grid of every destination in the app — the nav
 * already does that, and a "quick action" that is always the same four links
 * is just a second nav bar.
 */
export function selectQuickActions(facts: HomeSectionFacts): QuickAction[] {
  const actions: { action: QuickAction; priority: number }[] = [];
  const add = (priority: number, action: QuickAction) => actions.push({ action, priority });

  if (facts.hasLiveFollowedFixture) {
    add(TIER.NOW, {
      id: "live",
      label: "Watch live",
      href: "/live",
      hint: null,
    });
  }

  if (facts.fantasy && within(facts.now, facts.fantasy.deadlineAt, FANTASY_URGENT_MS) && !facts.fantasy.rosterConfirmed) {
    add(TIER.NOW + 30, {
      id: "fantasy",
      label: "Confirm squad",
      href: "/fantasy",
      hint: null,
    });
  }

  if (facts.predictions && facts.predictions.openCount > 0) {
    add(TIER.SOON + 20, {
      id: "predictions",
      label: "Your calls",
      href: "/predictions/mine",
      hint: String(facts.predictions.openCount),
    });
  }

  if (facts.unreadNotificationCount > 0) {
    add(TIER.SOON + 25, {
      id: "notifications",
      label: "Notifications",
      href: "/notifications",
      hint: String(facts.unreadNotificationCount),
    });
  }

  // Following nobody is the one thing that makes every section above
  // impossible, so it is offered loudly rather than as a footnote — unless the
  // lead is already the same invitation, in which case a pill repeating its
  // primary button two rows below it is the page saying one thing twice.
  if (
    facts.lead.kind !== "follow_a_club" &&
    facts.clubsTodayCount === 0 &&
    facts.upcomingCount === 0 &&
    facts.recentResults.count === 0 &&
    facts.followedPlayerCount === 0
  ) {
    add(TIER.SOON, {
      id: "follow",
      label: "Find your club",
      href: "/teams",
      hint: null,
    });
  }

  if (facts.aiConfigured) {
    add(TIER.CONTEXT, {
      id: "ai",
      label: "Ask the Copilot",
      href: "/ai",
      hint: null,
    });
  }

  add(TIER.BROWSE, { id: "social", label: "Open the feed", href: "/social", hint: null });

  return actions
    .sort((a, b) => a.priority - b.priority)
    .slice(0, MAX_QUICK_ACTIONS)
    .map((entry) => entry.action);
}
