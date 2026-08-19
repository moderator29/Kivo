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
  fantasy: null,
  predictions: null,
  trendingRoom: null,
  transferPulse: { count: 0, latestAt: null },
  followedPlayerCount: 0,
  topMatchCount: 0,
  upcomingCount: 0,
  aiConfigured: false,
};

const ids = (facts: HomeSectionFacts) => selectHomeSections(facts).map((section) => section.id);

describe("selectHomeSections", () => {
  it("shows a brand-new account only what is actually true for it", () => {
    // No follows, no fantasy, no predictions, nothing synced. Everything
    // personal is absent — not rendered as a zero.
    expect(ids(emptyFacts)).toEqual(["no_football_yet", "recently_viewed", "community"]);
  });

  it("never emits a section for a personal surface the viewer has not used", () => {
    const sections = ids({ ...emptyFacts, topMatchCount: 4 });
    expect(sections).not.toContain("fantasy");
    expect(sections).not.toContain("predictions");
    expect(sections).not.toContain("your_players");
    expect(sections).not.toContain("transfer_pulse");
    expect(sections).not.toContain("notifications");
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

  it("gives every section a reason, because the page shows it", () => {
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

  it("gives every action a hint drawn from a real fact", () => {
    const actions = selectQuickActions({
      ...emptyFacts,
      predictions: { openCount: 1, nextLockAt: inHours(5), currentStreak: 0 },
      unreadNotificationCount: 2,
    });
    expect(actions.find((a) => a.id === "predictions")?.hint).toBe("1 still open");
    expect(actions.find((a) => a.id === "notifications")?.hint).toBe("2 unread");
  });
});
