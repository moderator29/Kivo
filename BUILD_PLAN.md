# KIVO — Build Plan

What is built, what is next, and what is deliberately not being built. Written from the codebase as it stands, so it can be checked rather than believed.

This is the *plan*. `BUILD_STATUS.md` is the living per-feature state, `RECOMMENDATIONS.md` is the numbered backlog, and `DECISIONS.md` is why the hard calls went the way they did. This document is the shape those three sit inside.

---

## The one rule everything else follows from

**Zero fabricated data, ever.** Not football stats, not social proof, not user counts, not "trending", not a confidence label with no signal behind it.

Every "Coming Soon" in this product means genuinely not built. Every empty state that says "nothing synced yet" is telling the truth. A number KIVO cannot compute is absent, never zero — because a zero is a claim and an absence is not.

This is not a style preference. It is the reason the product can be trusted with a scoreline, and every phase below is bounded by it: a feature that can only ship by inventing a signal does not ship.

---

## Phase 1 — Foundation ✅

Complete.

- Next.js 16 App Router, TypeScript, Tailwind v4.
- Supabase Auth: email one-time code, no password, no social providers. Multi-account switching on one device.
- The normalized football schema — competitions → seasons → teams → players → fixtures → events → lineups → statistics → standings — with `provider_mappings` translating external ids to internal ones.
- RLS on every user-owned table, keyed on `auth.uid()`, with authorization decided by Postgres rather than by application code.
- A provider-agnostic football layer (`FootballDataProvider`) with three implementations, so KIVO is not wired to a vendor.
- 95 migrations and 854 unit tests as of 2026-08-19, with CI running typecheck / lint / test / build / asset-check on every push. Both numbers move daily; the point is that the gate is real, not the figure.

## Phase 2 — Product surfaces ✅

Complete.

- **Match Centre**: Timeline, Stats, Lineups, Heatmap, H2H, Standings, Room. Realtime fixtures and events.
- **Social**: feed with four scopes, Match Rooms, threaded comments, six reactions, polls, saves, reports.
- **Predictions**: six types (winner, correct score, first scorer, total goals, cards & corners, man of the match), XP, leaderboards, private leagues.
- **Fantasy**: squad builder, gameweeks, deadlines, private and public leagues, versioned scoring, roster carry-forward.
- **AI Copilot**: grounded retrieval first, streamed, with fact / insight / uncertainty visibly separated.
- **Team, player, league, manager and venue pages** on real synced data.
- **Admin**: seven server-verified roles, moderation queue, data health, support queue, entity merge, audit log.
- **Notifications**: fifteen types with real producers, per-category preferences, quiet hours, priority.

## Phase 3 — Depth ✅ (this pass)

The founding brief re-read against the code, and the gaps closed.

- **Six prediction types instead of one**, every one settled from data KIVO already syncs, with `unresolvable` as a real third answer so a prediction is never called wrong because KIVO never checked.
- **Templated Match Room polls** — man of the match seeded from the real starting XIs, referee decisions as a structured question — which is also what makes an MOTM prediction settleable at all.
- **Self-service block and mute**, reciprocal in visibility, undetectable by the person blocked.
- **Three notification types KIVO already had the data for** and had never sent: half time, penalties, lineups released.
- **Quiet hours, priority and timezone-aware delivery**, with the honest limits of each stated on screen.
- **Trending and fan sentiment**, on real time-windowed counts, with an explicit refusal to rank a window too quiet to mean anything.
- **`team_aliases` and `player_aliases`**, so a renamed club and a merged duplicate stay findable — and a producer for `provider_disagreement`, which had an enum value, an admin label and no writer.

---

## Phase 4 — Launch readiness (next)

Not started, and none of it is a code problem this session can finish.

| Item | Owner | Blocker |
|---|---|---|
| Real football data flowing | Founder | `API_FOOTBALL_KEY` + a fresh deployment |
| Live scores | Founder | Two Supabase Vault secrets + `FOOTBALL_LIVE_POLLING_ENABLED` |
| AI live | Founder | `ANTHROPIC_API_KEY` + a fresh deployment |
| Email at launch volume | Founder | Custom SMTP in the Supabase dashboard |
| Error tracking | Engineering | No service chosen |
| E2E regression suite | Engineering | — |
| Security review | External | Never performed |
| Trademark and store-name screening | Founder | Pre-launch, flagged since the acknowledgement |

**The first four cannot be done from a development session.** There is no key to add and no dashboard to click. Admin → Data Health's "Is data actually arriving?" panel is the only honest answer to whether they have been done.

---

## Phase 5 — After launch

Ordered by what real usage would make urgent, not by what is interesting.

1. **Push notifications.** The single largest missing capability. Quiet hours, priority and batching are all shaped by having exactly one in-app channel; push changes what each of them means and is the prerequisite for the brief's notification vision being fully real.
2. **Multi-provider failover.** The schema already allows it, `provider_disagreement` detection already fires the moment a second provider writes, and `provider_coverage` already distinguishes "cannot support" from "not synced yet". What is missing is the orchestration.
3. **Notification batching**, which needs a job queue rather than a cron entry point. See `NOTIFICATIONS.md` for why a half-built version would be worse than none.
4. **i18n.** English only. No i18n library, and nothing in the architecture blocks adding one.
5. **Native wrapper.** The web app was built responsive-first specifically so this does not require a rewrite.

---

## Deliberately not built

Recorded so nobody re-proposes them without knowing the reasoning.

| | Why |
|---|---|
| **Real-money predictions or fantasy** | XP and streaks only. Building toward cash mechanics without legal review would be an irreversible mistake to make silently. |
| **A public REST/GraphQL API** | No consumer exists, and it would mean a permanent contract over data KIVO licenses rather than owns. |
| **Direct messages** | No table, no stub. A DM system is a moderation and safety surface in its own right. |
| **`data_conflicts` as its own table** | It is `data_anomalies` (migration 0056) already. Two tables for one concept gives the admin queue two lists and a permanent question about which one a detection belongs in. See `DECISIONS.md`. |
| **A stored `priority` column on notifications** | Priority is a property of the type. A column would duplicate a fact and let two rows of one type disagree. |
| **Inferred aliases** | Fuzzy matching is how an alias is *used*, never how one is created. A guess must not be able to look like a recorded fact. |
| **A sentiment label** | "Positive"/"mixed" are boundaries somebody chose. The number and the count go on screen instead. |
| **Trending topics** | KIVO has no tags, and inferring a topic from post text is exactly the invented signal this product refuses. Rooms are ranked instead, because `posts.fixture_id` is real. |

---

## How work gets done here

- **One branch**: `claude/kivo-master-build-2qijfs`. `main` is never pushed to.
- **Commit through a private git index**, rebuilt from `HEAD` immediately before every commit. A reused index carries content from an earlier `HEAD` and silently reverts whatever landed in between — the commit succeeds and the build stays green, which is worse than a loud break.
- **Stage explicit paths**, never a directory and never `-A`. Read `git diff --cached --name-only` *before* committing; a path you did not personally edit should not be in it.
- **Verify by content after pushing**: `git show origin/<branch>:<file> | grep <marker>`. A successful push is not proof.
- **Migrations**: check both the directory and the live list immediately before creating *and* before applying; run the advisors afterwards.
- **UI**: screenshot at 390px in both themes before calling it done.
- **Every state**: loading, empty, error, partial, stale. A feature with only a happy path is not finished.
