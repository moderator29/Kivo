import { describe, expect, it } from "vitest";
import {
  MAX_QUICK_ACTIONS,
  TIER,
  selectHomeSections,
  selectQuickActions,
  type HomeSectionFacts,
} from "./home-sections";
import type { HomeLead } from "./home-lead";

/**
 * The ladder is the feature, so it is tested like one. Two things are being
 * pinned here: that a section is absent when it has nothing real behind it,
 * and that the order changes with the reader rather than with the JSX.
 */

const NOW = Date.parse("2026-08-19T12:00:00.000Z");
const inHours = (hours: number) => new Date(NOW + hours * 60 * 60 * 1000).toISOString();
const hoursAgo = (hours: number) => new Date(NOW - hours * 60 * 60 * 1000).toISOString();

const quietLead: HomeLead = { kind: "quiet", reason: "Nothing scheduled for your clubs yet" };

const emptyFacts: HomeSectionFacts = {
  now: NOW,
  lead: quietLead,
  briefingLineCount: 0,
  unreadNotificationCount: 0,
  clubsTodayCount: 0,
  hasLiveFollowedFixture: false,
  liveElsewhereCount: 0,
  recentResults: { count: 0, latestAt: null },
  fantasy: null,
  predictions: null,
  trendingRoom: null,
  feedPostCount: 0,
  transferPulse: { count: 0, latestAt: null },
  followedPlayerCount: 0,
  followedCompetitionCount: 0,
  topMatchCount: 0,
  upcomingCount: 0,
  aiConfigured: false,
};

const ids = (facts: HomeSectionFacts) => selectHomeSections(facts).map((section) => section.id);

describe("selectHomeSections", () => {
  it("shows a brand-new account only what is actually true for it", () => {
    // No follows, no fantasy, no predictions, nothing synced. Everything
    // personal is absent — not rendered as a zero.
    expect(ids(emptyFacts)).toEqual(["no_football_yet", "recently_viewed"]);
  });

  it("never emits a section for a personal surface the viewer has not used", () => {
    const sections = ids({ ...emptyFacts, topMatchCount: 4 });
    expect(sections).not.toContain("fantasy");
    expect(sections).not.toContain("predictions");
    expect(sections).not.toContain("your_players");
    expect(sections).not.toContain("transfer_pulse");
    expect(sections).not.toContain("notifications");
    expect(sections).not.toContain("results");
    expect(sections).not.toContain("live_now");
    expect(sections).not.toContain("feed");
    expect(sections).not.toContain("your_competitions");
  });

  it("opens a Saturday afternoon on live football and a Tuesday morning on the result", () => {
    // Same reader, same follows — the only difference is what football is
    // actually happening, which is the whole argument for a ladder.
    const saturday = ids({
      ...emptyFacts,
      clubsTodayCount: 1,
      hasLiveFollowedFixture: true,
      liveElsewhereCount: 8,
      recentResults: { count: 3, latestAt: hoursAgo(2) },
      unreadNotificationCount: 4,
      topMatchCount: 12,
      upcomingCount: 3,
    });
    expect(saturday.slice(0, 2)).toEqual(["clubs_today", "live_now"]);

    const tuesday = ids({
      ...emptyFacts,
      recentResults: { count: 2, latestAt: hoursAgo(11) },
      unreadNotificationCount: 4,
      topMatchCount: 12,
      upcomingCount: 3,
    });
    expect(tuesday[0]).toBe("results");
    expect(tuesday.indexOf("results")).toBeLessThan(tuesday.indexOf("notifications"));
  });

  it("treats last night's result as news and last month's as history", () => {
    const fresh = selectHomeSections({
      ...emptyFacts,
      recentResults: { count: 1, latestAt: hoursAgo(10) },
    }).find((s) => s.id === "results");
    const old = selectHomeSections({
      ...emptyFacts,
      recentResults: { count: 1, latestAt: hoursAgo(24 * 9) },
    }).find((s) => s.id === "results");

    expect(fresh?.priority).toBeLessThan(TIER.SOON);
    expect(old?.priority).toBeGreaterThanOrEqual(TIER.CONTEXT);
    expect(fresh?.reason).not.toEqual(old?.reason);
  });

  it("gives today's card the top slot only while the reader follows nothing", () => {
    const newcomer = ids({ ...emptyFacts, topMatchCount: 9 });
    expect(newcomer[0]).toBe("top_matches");

    // One follow is enough to demote it: the reader now has football of their
    // own on this page, and it outranks everybody else's.
    const follower = ids({ ...emptyFacts, topMatchCount: 9, upcomingCount: 2 });
    expect(follower.indexOf("upcoming")).toBeLessThan(follower.indexOf("top_matches"));
  });

  it("only shows a personalised feed when people the reader follows have posted", () => {
    expect(ids(emptyFacts)).not.toContain("feed");
    expect(ids({ ...emptyFacts, feedPostCount: 3 })).toContain("feed");
  });

  it("puts a live followed club above everything else on the page", () => {
    const sections = ids({
      ...emptyFacts,
      clubsTodayCount: 2,
      hasLiveFollowedFixture: true,
      unreadNotificationCount: 5,
      topMatchCount: 6,
      upcomingCount: 3,
    });
    expect(sections[0]).toBe("clubs_today");
  });

  it("lets an unread notification lead a quiet day, but not a live one", () => {
    const quietDay = ids({ ...emptyFacts, unreadNotificationCount: 3, topMatchCount: 4 });
    expect(quietDay[0]).toBe("notifications");

    const busyDay = ids({
      ...emptyFacts,
      unreadNotificationCount: 3,
      clubsTodayCount: 1,
      hasLiveFollowedFixture: true,
    });
    expect(busyDay.indexOf("clubs_today")).toBeLessThan(busyDay.indexOf("notifications"));
  });

  it("only shouts about a fantasy deadline that is close AND unconfirmed", () => {
    const urgent = selectHomeSections({
      ...emptyFacts,
      fantasy: { deadlineAt: inHours(4), rosterConfirmed: false, latestPoints: null, rank: null },
    });
    expect(urgent.find((s) => s.id === "fantasy")?.priority).toBeLessThan(TIER.SOON);

    const confirmed = selectHomeSections({
      ...emptyFacts,
      fantasy: { deadlineAt: inHours(4), rosterConfirmed: true, latestPoints: null, rank: null },
    });
    expect(confirmed.find((s) => s.id === "fantasy")?.priority).toBeGreaterThanOrEqual(TIER.SOON);

    const distant = selectHomeSections({
      ...emptyFacts,
      fantasy: { deadlineAt: inHours(80), rosterConfirmed: false, latestPoints: null, rank: null },
    });
    expect(distant.find((s) => s.id === "fantasy")?.priority).toBeGreaterThanOrEqual(TIER.CONTEXT);
  });

  it("stands down when the lead slot is already saying the same thing", () => {
    const facts: HomeSectionFacts = {
      ...emptyFacts,
      fantasy: { deadlineAt: inHours(3), rosterConfirmed: false, latestPoints: null, rank: null },
    };
    const shouting = selectHomeSections(facts).find((s) => s.id === "fantasy")?.priority ?? 0;

    const alreadyLed = selectHomeSections({
      ...facts,
      lead: {
        kind: "fantasy_deadline",
        reason: "Your fantasy squad isn't confirmed yet",
        gameweekNumber: 4,
        deadlineAt: inHours(3),
        rosterConfirmed: false,
      },
    }).find((s) => s.id === "fantasy")?.priority ?? 0;

    expect(alreadyLed).toBeGreaterThan(shouting);
  });

  it("shows a streak only when there is a real run, never a zero", () => {
    expect(ids({ ...emptyFacts, predictions: { openCount: 0, nextLockAt: null, currentStreak: 0 } })).not.toContain(
      "predictions",
    );
    expect(ids({ ...emptyFacts, predictions: { openCount: 0, nextLockAt: null, currentStreak: 3 } })).toContain(
      "predictions",
    );
  });

  it("treats a transfer from months ago as context, not as pulse", () => {
    const fresh = selectHomeSections({
      ...emptyFacts,
      transferPulse: { count: 2, latestAt: hoursAgo(20) },
    }).find((s) => s.id === "transfer_pulse");
    const stale = selectHomeSections({
      ...emptyFacts,
      transferPulse: { count: 2, latestAt: hoursAgo(24 * 40) },
    }).find((s) => s.id === "transfer_pulse");

    expect(fresh?.priority).toBeLessThan(stale?.priority ?? Infinity);
    expect(fresh?.reason).not.toEqual(stale?.reason);
  });

  it("ranks a followed club's Room above a stranger's", () => {
    const mine = selectHomeSections({
      ...emptyFacts,
      trendingRoom: { participantCount: 9, involvesFollowedClub: true },
    }).find((s) => s.id === "trending_rooms");
    const theirs = selectHomeSections({
      ...emptyFacts,
      trendingRoom: { participantCount: 40, involvesFollowedClub: false },
    }).find((s) => s.id === "trending_rooms");

    // Deliberately not by size: forty strangers matter less to this reader
    // than nine people arguing about their own club.
    expect(mine?.priority).toBeLessThan(theirs?.priority ?? Infinity);
  });

  it("gives every section a reason, so the ladder stays readable", () => {
    const sections = selectHomeSections({
      ...emptyFacts,
      briefingLineCount: 3,
      clubsTodayCount: 1,
      followedPlayerCount: 2,
      topMatchCount: 5,
      upcomingCount: 2,
    });
    expect(sections.length).toBeGreaterThan(4);
    for (const section of sections) {
      expect(section.reason.length).toBeGreaterThan(0);
    }
  });

  it("never shows the empty-football explainer alongside real football", () => {
    const sections = ids({ ...emptyFacts, topMatchCount: 3 });
    expect(sections).toContain("top_matches");
    expect(sections).not.toContain("no_football_yet");

    // Nor alongside the reader's own football, even on a day KIVO's wider card
    // is empty — a follower with a fixture on the way is not a blank slate.
    expect(ids({ ...emptyFacts, upcomingCount: 2 })).not.toContain("no_football_yet");
  });
});

describe("selectQuickActions", () => {
  it("caps the row so it stays a shortcut strip rather than a second nav", () => {
    const actions = selectQuickActions({
      ...emptyFacts,
      hasLiveFollowedFixture: true,
      unreadNotificationCount: 4,
      aiConfigured: true,
      predictions: { openCount: 2, nextLockAt: inHours(2), currentStreak: 1 },
      fantasy: { deadlineAt: inHours(2), rosterConfirmed: false, latestPoints: null, rank: null },
    });
    expect(actions.length).toBe(MAX_QUICK_ACTIONS);
    expect(actions[0].id).toBe("live");
  });

  it("offers following a club to someone who follows nobody", () => {
    expect(selectQuickActions(emptyFacts).map((a) => a.id)).toContain("follow");
  });

  it("never offers the Copilot when the Copilot is not configured", () => {
    expect(selectQuickActions({ ...emptyFacts, aiConfigured: false }).map((a) => a.id)).not.toContain("ai");
    expect(selectQuickActions({ ...emptyFacts, aiConfigured: true }).map((a) => a.id)).toContain("ai");
  });

  it("carries a counted number or nothing, never a sentence of explanation", () => {
    const actions = selectQuickActions({
      ...emptyFacts,
      predictions: { openCount: 1, nextLockAt: inHours(5), currentStreak: 0 },
      unreadNotificationCount: 2,
    });
    expect(actions.find((a) => a.id === "predictions")?.hint).toBe("1");
    expect(actions.find((a) => a.id === "notifications")?.hint).toBe("2");
    // Everything else offers a destination and no number — a pill reading
    // "Open the feed · What people are saying" is prose wearing a control.
    for (const action of actions) {
      if (action.hint !== null) expect(action.hint).toMatch(/^\d+$/);
    }
  });
});
