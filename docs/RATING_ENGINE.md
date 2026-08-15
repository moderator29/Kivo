# KIVO Rating Engine

Source: `src/lib/football/rating-engine.ts` (unit tests: `rating-engine.test.ts`).

## What this is

A pure, DB-client-free module that computes a 0-10 "match rating" for one
player in one finished fixture, from real data already synced into
Supabase — nothing else. It exists to formalize a rating feature honestly,
given a hard constraint: **API-Football's free tier supplies no player
ratings at all.** Any rating KIVO shows today is 100% KIVO-derived. This
module is built specifically so that fact is structural, not just a comment
someone has to remember.

## The `providerRating` / `kivoRating` contract

Every computed value is typed as:

```ts
{
  kivoRating: number;      // KIVO's own computed score, 1.0-10.0
  providerRating: null;    // always null today — see below
  modelVersion: string;    // RATING_MODEL_VERSION, e.g. "1.0"
  positionGroup: "Goalkeepers" | "Defenders" | "Midfielders" | "Forwards" | "Other";
}
```

`providerRating` is typed as `null` — not omitted, not optional, not a
union that quietly defaults somewhere — so:

1. It's structurally impossible for `kivoRating`'s value to leak into a
   field a future reader might assume is an official/vendor number.
2. When a real ratings-capable provider is eventually connected, only the
   code that builds `PlayerMatchRatingInput` and constructs the final
   object needs to change — every consumer of this type already has a real
   slot to read a provider value from.

**No UI surface reads this module yet.** See "Why no UI wiring" below.

## Real inputs only — what is and isn't used

Checked directly against the schema (`lineups`, `fixture_events`,
`fixtures`, `fixture_statistics`) before writing this, per the standing
"zero fabricated data" rule:

| Input | Source | Used? |
|---|---|---|
| `is_starting` | `lineups` | Yes — only real evidence of involvement without a minutes column |
| Goals / assists | `fixture_events` (`goal`, `penalty_goal`, `related_player_id`) | Yes |
| Own goals | `fixture_events` (`own_goal`) | Yes |
| Yellow / red cards | `fixture_events` | Yes (second yellow counts as a red, same as `fantasy-scoring.ts`) |
| Team's final score | `fixtures.home_score`/`away_score` | Yes — the only real defensive signal available (see below) |
| `players.position` | `players` | Yes, via the shared `positionGroup()` classifier (`fantasy-rules.ts`) — never a second taxonomy |
| Minutes played | **does not exist in the schema** | Not used — see "no minutes" below |
| Saves, tackles, duels, passes, per-player defensive actions | **does not exist per-player** (`fixture_statistics` is team-level only) | Not used — never invented |
| Official/provider rating | **does not exist on the free tier** | `providerRating` stays `null` |

Nothing here was invented to fill a gap. Where the schema has no real
column for a stat that genre-standard rating models usually use (minutes,
saves, tackles, duels, pass completion per player), the model simply does
not use it, rather than approximating it from something else.

## No minutes-played column — how the engine copes honestly

`lineups` has `is_starting` (boolean) but no minutes-played or
substitution-minute column. API-Football's `/fixtures/lineups` response —
and therefore this table — includes every named substitute whether or not
they actually came on (`getLineups` in `providers/api-football.ts`). That
means a bench player who never played a minute is otherwise
indistinguishable from one who played 30.

The engine's rule: a player is only rated for a match if `isStarting` is
true, **or** they have at least one real `fixture_events` row for that
match (a goal, assist, card, etc. — real evidence they were on the pitch).
Anyone else — an unused substitute with zero recorded events — gets `null`,
not a fabricated baseline rating. This is the direct, literal application
of the task's own example: "player has 0 minutes that match → return null."

## Position-aware, not just GK-vs-outfield

The brief's minimum bar was goalkeepers scored differently from outfield
players. `RATING_WEIGHTS` goes one step further and reuses the same
four-group classification (`Goalkeepers`/`Defenders`/`Midfielders`/
`Forwards`, plus `Other` for an unclassified free-text position) that
`fantasy-scoring.ts`'s `GOAL_POINTS_BY_POSITION` already established as
KIVO's shared position-weighting convention — a goal from a goalkeeper or
defender counts for more than one from a forward, and only goalkeepers and
defenders get a clean-sheet bonus / goals-conceded penalty, since a team's
defensive record is real, team-level data (`fixtures.home_score`/
`away_score`) attributable to those two groups specifically, not to
midfielders or forwards.

## The model

```
kivoRating = clamp(
  BASE_RATING (6.0)
  + goals            * weights.goal
  + assists          * weights.assist
  + ownGoals         * weights.ownGoal
  + yellowCards      * weights.yellowCard
  + redCards         * weights.redCard
  + (GK/DEF only) cleanSheetBonus OR goalsConceded * goalsConcededPenaltyPerGoal
  , min: 1.0, max: 10.0
)
```

All of the weight numbers live in one place: the exported
`RATING_WEIGHTS` constant. Nothing is a magic number scattered through the
function body. `RATING_MODEL_VERSION` (currently `"1.0"`) is stamped onto
every computed rating so a future change to these weights — or to which
real inputs the model uses at all — is traceable on historical values
instead of silently reinterpreting them.

`BASE_RATING = 6.0` is a **model constant**, not a fabricated observation:
it is the neutral anchor every eligible player's rating starts from before
real per-match inputs move it up or down, the same convention the
Whoscored/Sofascore-style "match rating" genre uses. It says nothing about
how a specific player actually performed until real data changes it.

## Season aggregation

`aggregateSeasonRating(ratings)` averages a set of a player's own
already-computed match ratings. It:

- returns `null` only for zero ratings,
- otherwise returns a value with an `isSufficientSample` flag (false below
  `MIN_RATING_SAMPLE = 3`) so a UI can choose to show a small-sample number
  with an honest caveat rather than hide it outright, and
- excludes any ratings computed under a different `modelVersion` from the
  average, rather than silently blending two different models' outputs
  into one misleading number.

## Why this isn't wired into a UI surface yet

The task's own instruction: *"Do NOT wire this into a highly visible UI
surface yet unless you have strong confidence in the model and time to
verify it thoroughly... never ship a rating number to a real screen without
being confident it isn't misleading."*

This pass delivered the engine, a real unit test suite (31 assertions
across the whole intelligence-layer test set, all passing), and this
methodology doc — but not a live UI surface, because:

1. **The model has had zero exposure to real match data.** Every test uses
   hand-constructed inputs; the weights (`RATING_WEIGHTS`) are reasoned
   defaults extending an existing convention (`fantasy-scoring.ts`'s
   position weighting), not calibrated against real KIVO-synced matches.
   Shipping an uncalibrated number as "your player's rating" risks looking
   arbitrary or wrong to a football-literate user in a way that damages
   trust in every other, real, number on the page.
2. **The "no minutes" gap is a real, user-visible limitation**, not just an
   internal implementation detail — a fully-honest UI would need copy
   explaining why a 90th-minute substitute who did nothing gets the same
   treatment as an unused one (both `null`), which needs product/design
   input this pass didn't have time to get right.
3. The founder directive that opened this whole build pass was explicit:
   *"Never sacrifice data accuracy for visual completeness."* An engine
   that exists, is tested, and is documented — but isn't yet shown to a
   real user — is the conservative reading of that instruction when time
   didn't allow for the calibration pass a rating feature deserves.

**Recommended next step** (also logged in `RECOMMENDATIONS.md`): once a
meaningful number of real fixtures have `fixture_events` + `lineups` +
final scores synced, spot-check `computePlayerMatchRating` output against
known real performances (a hat-trick striker should rate clearly higher
than a quiet game) before wiring it into `players/[id]/page.tsx` or the
Match Centre lineup view, gated behind the same kind of honest "insufficient
sample" messaging the Form Engine already uses.

## Calibration tooling — `scripts/calibrate-rating-engine.ts`

This pass (2026-08-15) added the calibration *tool*, not a calibration
*result*. The live Supabase project was queried directly before writing
anything here: **zero finished fixtures exist in the live database today**
(confirmed via the Supabase MCP `execute_sql` tool — `select count(*) from
fixtures where status = 'finished'` returned `0`). There is no real signal
to calibrate against yet, so no calibration happened, and `RATING_WEIGHTS`
was not touched. Per the standing "zero fabricated data" rule, this pass
explicitly did **not** invent synthetic matches, seed fake lineups/events, or
hand-tune weights and call the result "calibration" — that would fabricate a
data-driven model while claiming otherwise.

`npm run calibrate:ratings` runs `scripts/calibrate-rating-engine.ts`
against the live project (needs `SUPABASE_SERVICE_ROLE_KEY`). It:

1. Pulls every real `finished` fixture plus its real `lineups` and
   `fixture_events` rows.
2. Computes `kivoRating` for every real player-match via the unmodified,
   already-shipped `computePlayerMatchRating` — the exact function the UI
   would eventually call, not a re-implementation.
3. Prints a distribution (mean/median/stddev/histogram, by position group),
   the highest- and lowest-rated real performances for a human to
   spot-check by eye, and a win/draw/loss sanity check (do players on real
   winning teams rate higher on average than players on real losing teams?).
4. If there are zero finished fixtures, or fewer than
   `MIN_RATINGS_FOR_REPORT` (20) real computed ratings, it says so in plain
   language and stops — it never pads a thin real sample with anything
   invented, and it never claims a report is meaningful when the underlying
   sample is not.
5. Never writes to the database and never edits `RATING_WEIGHTS` itself —
   it is read-only reporting for a human to act on, not an auto-tuner.

### Calibration checklist — what "calibrated" concretely means

The engine can be considered calibrated, and item 225/229 unblocked, once
**all** of the following are true on a real run of
`npm run calibrate:ratings` against the live project:

- [ ] The live project has a real, meaningful volume of finished fixtures
      with synced lineups and events — not just past `MIN_RATINGS_FOR_REPORT`
      (20) in the script's own gate, but enough that a human reviewing the
      report has genuine confidence it isn't a fluke of a handful of matches
      (a few hundred real rated player-matches, spanning more than one
      competition/team where possible, is a reasonable bar).
- [ ] The distribution looks like a real football rating distribution: most
      players clustered near the 6.0 baseline, a real tail in both
      directions — not degenerate (e.g. everyone bunched at exactly 6.0,
      which would mean the event data isn't actually reaching the engine).
- [ ] A human has spot-checked at least 10 of the "Highest-rated real
      performances" and 10 of the "Lowest-rated real performances" the
      script prints against what actually happened in those real matches
      (a 5-goal Champions League final performance should be near the top;
      a two-yellow-one-red disaster should be near the bottom) and confirmed
      they look right by eye, not just numerically plausible.
- [ ] The win/draw/loss sanity check in the script's output PASSes: players
      on real winning teams rate higher on average than players on real
      losing teams. If this fails on a real, meaningfully-sized sample, that
      is a signal something in the model or its inputs is actually wrong —
      calibration is not done until this passes.
- [ ] A human — not an automated process — has reviewed the above and
      explicitly signed off that `RATING_WEIGHTS` is trustworthy enough to
      show a real user, in a commit/PR that says so.

Until every box above is real and checked, the engine stays exactly where it
is today: built, tested against hand-built inputs, documented, and
deliberately not wired into any UI. Item 229 (season-average rating chips on
squad lists) stays correctly blocked on this checklist, not just on item 225
existing as a to-do.
