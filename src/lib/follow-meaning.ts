/**
 * What following something actually does (KN-51).
 *
 * Following is KIVO's single most load-bearing personalisation gesture — it
 * decides what leads /home, what reaches your notifications, and what the
 * Following feed contains — and until this existed the entire explanation of
 * it was a star that changed colour. A user could not tell whether they had
 * subscribed to alerts, bookmarked something, or done nothing at all.
 *
 * Every sentence below is checked against a real consumer:
 *
 * - **team** — `teamAudience()` in src/lib/football/match-notifications.ts
 *   (kickoff, goal, red card, full time), plus /home's lead slot and "Your
 *   teams" (src/lib/home-lead.ts, src/app/(app)/home/page.tsx).
 * - **player** — `playerAudience()` in the same file (goals, red cards, and
 *   "a player you follow was involved").
 * - **user** — the Following tab of the feed
 *   (src/app/(app)/social/posts.ts) and a `new_follower` notification to them.
 * - **competition** — deliberately the flattest sentence of the four, and
 *   re-checked against every consumer on 2026-08-19 (the audit the
 *   coordinator asked for after a `.eq("followed_type", "team")` on /home
 *   made half the graph invisible). A competition follow has exactly three real
 *   consumers: your Following list, `buildGroundingContext` in
 *   src/lib/ai/grounding.ts, which passes the competitions you follow to the
 *   Copilot as context — and, since the matches list was rebuilt around
 *   competition groups, the star on each competition header on /matches and
 *   /live, which pins that competition to the top of the list for you
 *   (src/lib/football/competition-tier.ts). That star writes an ordinary
 *   `follows` row through this same `toggleFollow` action; there is no
 *   separate "favourites" concept, which is why favouriting a competition on
 *   /matches also makes it appear under Following. It has none in
 *   match-notifications.ts, none in
 *   watchlist-digest.ts and none on /home — all three are scoped to teams and
 *   players, and deliberately: a division is ~380 fixtures, so a per-goal
 *   audience would be spam and a 12-item digest would be drowned by one
 *   matchday. So the sentence says "bookmark, not a subscription" — which is
 *   still true of alerts — but it no longer claims the follow does *nothing*,
 *   because the Copilot really does read it. That earlier wording was stale,
 *   and a stale sentence here is how a built feature gets rebuilt.
 *
 * Kept as data rather than inline JSX so the same sentence is used by the
 * confirmation that appears when you follow *and* by the Following page that
 * explains your follows later — two surfaces that would otherwise drift.
 */

export type FollowTargetKind = "team" | "player" | "competition" | "user";

export const FOLLOW_MEANING: Record<FollowTargetKind, string> = {
  team: "Kickoff, goals, red cards and full time reach your notifications, and their fixtures lead your home screen.",
  player: "You'll hear when they score, get sent off, or feature in a match KIVO is covering.",
  competition:
    "It's pinned to the top of your matches list, saved to your Following list, and used as context when you ask the Copilot about football. KIVO doesn't send competition alerts — this is a bookmark, not a subscription.",
  user: "Their posts show up in your Following feed, and they'll know you followed them.",
};

/** The muted counterpart. Only team and player follows can be muted
 * (`follows.muted`, migration 0049) — the audiences those two feed are the
 * only ones a mute has anything to exclude you from. */
export const FOLLOW_MUTED_MEANING: Record<"team" | "player", string> = {
  team: "Muted. They stay on your home screen and in your lists, but no match alerts will reach you.",
  player: "Muted. They stay in your lists, but no match alerts about them will reach you.",
};
