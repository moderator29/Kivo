# KIVO Fantasy Scoring ("FantasyScoringEngine")

Source: `src/lib/fantasy-scoring.ts` (unit tests: `fantasy-scoring.test.ts`).

This module already exists, is real, and is working — this doc documents it
accurately as the founder's requested "FantasyScoringEngine"; the module
itself was not rebuilt or renamed this pass. `FantasyScoringEngine` is an
alias for what the file already does, not a new implementation. The file
wasn't renamed from `fantasy-scoring.ts` because every call site
(`src/app/admin/football/fantasy-actions.ts`, the "How scoring works" UI
at `src/app/(app)/fantasy/how-scoring-works.tsx`, its own test file) already
imports it by that path, and a rename this late in the session — while a
sibling work stream has an active, uncoordinated edit in flight on an
adjacent file in the same directory tree — carries real risk of a merge
collision for close to zero product value. If a rename is wanted later, it's
a pure mechanical `git mv` + import-path update with no logic change.

## What it actually does

Pure, framework/DB-client-free scoring rules — no Supabase client, no React
— so both the real scoring action
(`generateFantasyGameweekScores`/`scoreGameweek` in
`src/app/admin/football/fantasy-actions.ts`, admin-triggered) and the
published "How scoring works" UI (`how-scoring-works.tsx`) import the exact
same numbers. Nothing shown to a user can drift from what actually gets
computed and written to `fantasy_rosters`.

Built only from what the schema actually tracks:

- **`fixture_events.event_type`**: `goal`, `own_goal`, `penalty_goal`,
  `penalty_missed`, `yellow_card`, `second_yellow_card`, `red_card`,
  `substitution`, `var_review`.
- **`fantasy_rosters`**: `is_starting`, `is_captain`, `is_vice_captain`.

### The rules (exported as `SCORING_RULES_SUMMARY` — the single source the
UI renders from)

| Event | Points |
|---|---|
| Starting XI appearance | `APPEARANCE_POINTS` = +2. Bench players score 0 — the schema has no substitute-comes-on concept for *fantasy* squads. |
| Goal | Position-weighted via `GOAL_POINTS_BY_POSITION`: GK/DEF +6, MID +5, FWD +4. Unclassified position → flat `FLAT_GOAL_POINTS` = +5. |
| Assist (`related_player_id` on a goal event) | `ASSIST_POINTS` = +3. |
| Clean sheet (GK/DEF only, team concedes 0 in a finished fixture) | `CLEAN_SHEET_POINTS` = +4. |
| Yellow card | `YELLOW_CARD_POINTS` = −1. |
| Red card or second yellow | `RED_CARD_POINTS` = −3. |
| Own goal | `OWN_GOAL_POINTS` = −2. |
| Captain | Doubles that roster slot's total. |
| Vice-captain | Doubles instead, but only if the captain didn't start (see limitation below). |
| `penalty_missed`, `substitution`, `var_review` | No scoring effect — real, tracked event types with deliberately no rule, kept auditable rather than exhaustive. |

## Documented limitation (carried over, not new)

"Did the captain actually play" is approximated by the captain's own
`fantasy_rosters.is_starting` flag for that gameweek — **not** by any real
match appearance record. The schema has no play-time/substitution-on-the-
pitch data tied to a specific fantasy pick (`lineups.is_starting` reflects
the real match XI, not the fantasy squad, and isn't joined here). So "the
captain didn't play" really means "the manager didn't start their captain
in their fantasy XI for that gameweek" — a fantasy-selection fact, not a
confirmed real-world one. This is a deliberate, documented simplification,
not an oversight.

## Real consumer

`generateFantasyGameweekScores` in
`src/app/admin/football/fantasy-actions.ts` is the one real call site
that writes scores: it loads a gameweek's finished fixtures + events +
rosters, calls `computePlayerMatchFacts` then `scoreRosterSlot` per roster
row, and persists the totals. It's admin-triggered (`canManageFootballData`
gated), not an automated cron — consistent with the platform's "no cron/
polling" standing rule.

---

# 2026-08-19: auditable scoring, versioned rules, transfers, live points

Everything above describes the scoring formula and is still accurate. What
follows is what was added around it, and what remains genuinely unbuildable.

The founding directive's sentence is the one this pass exists for: **every
awarded point must trace to verified match/player data, and KIVO must never
silently calculate fantasy points from missing data.** Fantasy was doing both
of the things that sentence forbids.

## 1. A score you can audit — `fantasy_point_breakdowns` (migration 0095)

`fantasy_points` stored one integer. The scorer computed the appearance, each
goal at its position weight, the clean sheet and the cards, and threw every
component away. A manager could not ask why they got 47, and neither could
KIVO.

One row per (team, gameweek, player), holding **both** the counts from
`fixture_events` and the points each produced. Both, deliberately:

- counts alone cannot be reconciled against the total;
- points alone cannot be reconciled against the match.

With both, a disputed score resolves to either a **wrong count** (a sync
problem) or a **wrong rate** (a rule problem) — different bugs with different
fixes. `GameweekScorecard` renders it, and checks the identity
`sum(total_points) + transfer_points_cost = points` on every render. If it does
not hold, it says so and tells the reader to trust neither number.

## 2. The silent-wrong-score hole — `fixtures_with_events`

**A finished fixture whose events have never synced produces exactly the same
points as a real goalless, cardless match.** The scorer sees no events either
way, so every player in it gets the appearance point and nothing else, and a
hat-trick that never arrived is invisible in the total. That total was then
written looking final.

`fixtures_with_events` counts how many finished fixtures actually carry events.
It is the only thing that can distinguish those two cases — and it deliberately
does not claim which one it is, because a genuinely eventless match is rare but
real. It is a signal the UI explains, not a verdict.

`status` is `final` only when **every** fixture has finished **and** every
finished fixture has events. That is conservative in the right direction: a real
0-0 with no bookings will hold a gameweek at `provisional`, which costs a caveat
on screen, where the alternative is telling somebody their score is settled while
a goal is missing from it.

## 3. Versioned rules — `fantasy_scoring_rulesets` (migration 0095)

`SCORING_MODEL_VERSION` was a *label*. It said which ruleset produced a score
and nothing about what that ruleset said, because the values lived only in
TypeScript. Two consequences, and the directive names the second:

- a past gameweek could not be re-explained — an itemised breakdown would be
  shown against today's rates and would not add up to the stored total;
- re-running the scorer on an old gameweek silently rescored it under the new
  rules. **Last week's scores moved, and nothing said so.**

The values are now stored per version. The **formula** stays in TypeScript
(`scoreRosterSlotBreakdown`); the **numbers** are passed in. That split is
deliberate in both directions — a fully data-driven formula would be a small
interpreter nobody can read or test, and fully hardcoded numbers are the problem
being fixed.

A missing or malformed ruleset **refuses the scoring run**. The obvious fallback
("use the constants") is harmless today, when those constants are version 1.0,
and becomes a score no version can explain the moment somebody bumps the version
without seeding the row. `parseScoringRules` returns `null` rather than a
partially-defaulted object for the same reason: one field quietly filled from
elsewhere is a hybrid ruleset nobody declared.

## 4. Transfers — `fantasy_transfers` (migration 0098)

There were **no transfer rules at all**. `setGameweekRoster` accepted any fifteen
players that passed `validateRoster`, so a manager could rebuild their entire
squad every gameweek, for free, forever.

One free change per gameweek; each further change costs 4 points. The first squad
a team ever sets is free and unlimited.

**Counted against the previous gameweek's squad, never against the current
draft.** This is the rule that makes it usable rather than punitive: roster rows
are created by carry-forward and then edited, possibly many times, before the
deadline. Charging per edit would bill a manager for changing their mind — swap
a player in, swap them back out, and they are two transfers down having ended
exactly where they started. Diffing against last week makes the cost a function
of the **net** change.

The cost is stored as its own column on `fantasy_points` rather than folded into
`points`, so the itemised breakdown still reconciles and a manager who took a hit
sees the hit as a line rather than four points they cannot account for.

## 5. Live points

Not new machinery — the existing scorer, called more often, over data the live
worker is already writing. It needed two things that did not exist before:
something writing `fixture_events` during a match (the live worker), and a way
for a mid-match total to say what it is (`status` + the fixture counts). A score
that moves and does not admit it is provisional is worse than one that does not
move at all.

`rescoreLiveGameweeks` runs after each live sync, re-scores only the **current**
gameweek of seasons with a match in play or just finished, caps at 3 gameweeks
per firing, and **spends no provider quota** — every input is read from KIVO's
own tables.

Past gameweeks are never re-scored by it. That would be precisely what migration
0095 exists to prevent: a settled score silently recomputed by a background job
nobody asked.

## 6. Where the roster can be written from

`fantasy_rosters` has **no user-facing INSERT/UPDATE/DELETE policy** (migration
0097, landed by the security sweep). RLS is default-deny for writes, and the
validated actions — running as `service_role` — are the only writers.

The reasoning, because the question recurs: the **deadline** and **ownership**
are facts about one row, so a per-row `WITH CHECK` can decide them. The
**budget, squad size, formation and per-club cap** are properties of the SET of
fifteen rows — "this squad costs 99.5 of 100" is unanswerable while looking at
one player, and `setGameweekRoster` deletes departing players before upserting,
so mid-statement the set is legitimately inconsistent. A partial predicate would
have closed "edit after kickoff" while leaving "field sixteen players, or fifteen
strikers, or £300 of squad" open, **while looking like the rules were enforced at
the data layer** — the version that stops people checking.

`carryForwardFantasyRoster` also runs as `service_role`, and that is not a
workaround: it writes for the current gameweek *including after its deadline*,
which is exactly when a manager who never opened the app needs their squad
carried. It is KIVO applying a documented rule on the manager's behalf.

## What is genuinely NOT buildable, with the evidence

- **Per-player match statistics as a scoring input.** `docs/API_FOOTBALL.md`
  records `/fixtures/players` as unavailable on the free tier. The endpoint,
  the `fixture_player_statistics` table and its sync all exist (migration 0081)
  and are gated behind the coverage registry, but until a registry sync against
  a real key says otherwise, **scoring cannot depend on minutes played, shots,
  tackles or a provider rating.** The scoring rules above are built only from
  `fixture_events`, which is why they are goals, assists, cards, own goals and
  clean sheets and nothing finer.
- **Bonus points.** Every real fantasy game awards them from a performance
  index built on per-player match statistics. Same blocker as above.
- **"Did the captain actually play."** Approximated by the captain's own
  `fantasy_rosters.is_starting` flag — a fantasy-selection fact, not a
  confirmed real-world one. `lineups.is_starting` is the real match XI and is
  not joined here. This is the limitation documented in the section above and
  it is unchanged; it becomes properly answerable with per-player match stats.
- **Minutes-based appearance points** (60-minute thresholds, and the
  substitute-comes-on case). Same blocker.

## What could not be tested

The scoring arithmetic, the rule parsing and refusal, the transfer counting
basis and the negative-zero case are unit-tested (`fantasy-scoring.test.ts`,
`fantasy-rules.test.ts`). What is **not** tested is any of it against a real
match: this database has zero football rows, and the sandbox cannot reach
api-football.com. Nobody here has watched a fantasy score move during a game.
The first real matchday is the first real test, and the scorecard's own
reconciliation check is what will surface a discrepancy if one exists.
