# KIVO Fantasy Scoring ("FantasyScoringEngine")

Source: `src/lib/fantasy-scoring.ts` (unit tests: `fantasy-scoring.test.ts`).

This module already exists, is real, and is working — this doc documents it
accurately as the founder's requested "FantasyScoringEngine"; the module
itself was not rebuilt or renamed this pass. `FantasyScoringEngine` is an
alias for what the file already does, not a new implementation. The file
wasn't renamed from `fantasy-scoring.ts` because every call site
(`src/app/admin/data-health/fantasy-actions.ts`, the "How scoring works" UI
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
`src/app/admin/data-health/fantasy-actions.ts`, admin-triggered) and the
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
`src/app/admin/data-health/fantasy-actions.ts` is the one real call site
that writes scores: it loads a gameweek's finished fixtures + events +
rosters, calls `computePlayerMatchFacts` then `scoreRosterSlot` per roster
row, and persists the totals. It's admin-triggered (`canManageFootballData`
gated), not an automated cron — consistent with the platform's "no cron/
polling" standing rule.
