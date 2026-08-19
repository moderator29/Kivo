# KIVO Heatmap Engine

Sources:
- `src/lib/football/heatmap/` — the five services
- `src/lib/football/heatmap-engine.ts` — `HeatmapEngine`, the original grid
  builder for real tracked coordinates (unit tests: `heatmap-engine.test.ts`)
- `src/lib/football/positional-types.ts` — the `PositionalDataProvider` seam
- `src/components/matches/heatmap-view.tsx` — `HeatmapView`, the UI
- `src/app/(app)/matches/heatmap-actions.ts` — the server action
- Migration `0081` — `lineups.grid`, `fixture_player_statistics`,
  `player_heatmaps`
- Unit tests: `src/lib/football/heatmap/heatmap-services.test.ts` (26 cases)

## The finding everything here rests on

**API-Football publishes no pitch coordinates. Not on the free tier, and not
on any tier.**

- `/fixtures/events` returns, per event: `time{elapsed, extra}`, `team`,
  `player`, `assist`, `type`, `detail`. Nothing spatial.
- `/fixtures/players` returns counts — shots, passes, tackles, interceptions,
  duels, dribbles, fouls, minutes. It says what a player did, never where.
  There is not even a `touches` field.
- `/fixtures/lineups` returns one genuinely positional field: `grid`, a
  `"row:col"` string per starter. That is a **formation slot**, not tracking
  data — it says where a player lined up, never where they went.

**Confidence, stated plainly.** This build environment cannot reach
api-football.com (the outbound proxy refuses the CONNECT), so none of the above
was re-confirmed against a live response for this pass. It is established from
the committed adapter, which was itself written against real responses. Every
new response interface added in this pass is declared with optional fields and
read through `parseProviderNumber` / `parseCoverageFlag`, so a payload that
nests differently produces **nulls** — "the provider did not report this" —
rather than a crash or a wrong number. Where a shape could be wrong, the
failure mode is a missing number, never a fabricated one.

## What this means for the feature

The founder's spec anticipated exactly this case:

> If true coordinates are NOT available for a match, DO NOT fake data — fall
> back to the best available event-based visualization and label it
> appropriately.

So KIVO builds a **derived** heatmap, and the derivation is carried in the
data rather than in the UI copy. Every grid the engine produces has a
non-optional `derivation` field (`"tracked"` or `"derived"`), and
`HeatmapView`'s caption is generated from that field. There is no code path
that renders a shape without the sentence explaining what it was built from,
because the shape and the sentence are read off the same object.

Today that sentence always begins **"Not tracking data."**

## The five services

| Service | File | Responsibility |
|---|---|---|
| `HeatmapService` | `heatmap-service.ts` | The only one that touches the database. Loads real inputs, runs the pure engine, caches. Spends **zero** provider quota. |
| `EventNormalizer` | `event-normalizer.ts` | Every source becomes one `NormalizedPitchAction`. |
| `PlayerPositionMapper` | `player-position-mapper.ts` | Team sheet → a canonical anchor, with explicit confidence. |
| `HeatmapAggregator` | `heatmap-aggregator.ts` | Anchor + actions → a zone grid, tagged with its derivation. |
| `HeatmapCache` | `heatmap-cache.ts` | `player_heatmaps`, keyed by an inputs fingerprint. |

Plus two supporting modules: `pitch-coordinates.ts` (the canonical space) and
`fixture-heatmap.ts` (pure assembly, importable from a client component).

### The line `EventNormalizer` never crosses

`NormalizedPitchAction.coordinate` is `PitchCoordinate | null`, and it is
non-null for real `PositionalObservation`s and for **nothing else**. A tackle
nobody located does not acquire an x and a y on the way through this module.

That is the difference between an honest approximation and a fabrication. A
fabrication would put a plausible coordinate on a counted action, hand it to
`HeatmapEngine` alongside real observations, and become indistinguishable from
measurement one function call later — including in `sourcesUsed`, `hasData`,
and anything ever built on top of them.

`period` is nullable for the same reason. A goal in the 63rd minute happened in
the second half; a player's 41 completed passes did not happen in any
particular half, because the provider reports one number for the match. So
statistic-derived actions carry `period: null`, a half-match view genuinely
excludes them, and `AggregatedHeatmap.actionsWithoutPeriod` reports how many
were dropped so the UI can say so.

### Two coordinate spaces, deliberately

| | `NORMALIZED_PITCH` (`pitch-coordinates.ts`) | `PITCH_DIMENSIONS` (`heatmap-engine.ts`) |
|---|---|---|
| Size | 100 × 100 | 100 × 140 |
| Meaning | Semantic. `y = 0` is the subject's own goal line, `y = 100` the goal they are attacking. `x` runs left-to-right from the attacking team's view. | Rendering. Matches the `0 0 100 140` viewBox `PitchLines` draws. |
| Changes when | Never — it is a claim about a football pitch. | The pitch graphic changes. |

`toRenderSpace()` is the single, tested seam between them, and it owns the
y-axis inversion: canonical y grows towards the goal being attacked, SVG y
grows downwards, and every KIVO pitch draws attack at the top. Conflating the
two would mean a provider integration had to know KIVO's SVG aspect ratio to
report a position, and changing the pitch graphic would silently change what
every stored coordinate meant.

### What the derived model claims, exactly

Three things, each traceable to a real input:

1. **This player lined up here** — from the team sheet's `grid`, or from their
   listed position when there is no grid.
2. **Their involvement leaned defensive or attacking** — from real counted
   actions, via `CLASS_DEPTH_OFFSET`.
3. **KIVO does not know their lateral position** — or knows only that they were
   wide on one side without knowing which.

It claims nothing about time, distance covered, or where any individual action
happened. Those are not in the inputs and are not in the output.

Point 3 is why lateral spread **widens** as confidence drops rather than
sharpening. A heatmap that looks precise about something KIVO cannot see is
worse than a diffuse one, because only the diffuse one is legible as
uncertainty.

### The unverified thing, and how it is handled

API-Football's `grid` is documented as `"row:col"` with row 1 as the
goalkeeper's line, counting upfield. Two things could not be verified here:

- **whether column 1 is the team's left or its right.** Unresolvable by
  arithmetic, so it is not resolved. The mapper reports
  `lateralConfidence: "provider-order"`, the aggregator spreads laterally
  instead of committing, and the UI says left and right are unconfirmed. A
  mirrored heatmap looks completely authoritative and is 50/50 wrong.
- **whether the column count per row is stable.** Handled by self-calibrating:
  the mapper takes the observed maximum row and per-row maximum column from the
  actual team sheet rather than parsing the formation label, because
  `"4-2-3-1"` and the grid rows a provider sends do not always agree on how to
  count lines.

Depth (`depthConfidence`) is safe to trust; row order upfield is unambiguous.

### Substitutes are never anchored

A substitute has no formation slot, may have played fifteen minutes in a shape
nobody recorded, and drawing them on a pitch as though they held a position for
ninety minutes would be the most misleading thing the mapper could do. They are
listed in the UI as "not shown", with the reason.

## Caching

`player_heatmaps`, one row per `(fixture, player, period)`. Period is part of
the key because a first-half shape and a second-half shape are genuinely
different answers.

**Invalidated by inputs, never by a clock.** A TTL is wrong in both directions:
a finished fixture's shape is as true next year as it was on the night, and a
live fixture's is wrong within minutes. So a row carries
`inputs_fingerprint` (a digest of the lineup, events and player statistics that
fed it, sorted before hashing so it depends on the data and not on row order)
and `engine_version` (bumped when the derivation model changes). A row that
does not match both is ignored and regenerated.

Only settled fixtures are written back — a live match's inputs change every few
minutes, so caching one would be churn for an answer about to be wrong.
`syncFixturePlayerStatistics` additionally deletes a fixture's cached rows when
it writes, because that is the one moment KIVO knows for certain every grid for
that fixture is out of date.

## Quota

**The heatmap spends no provider quota.** Every input is read from KIVO's own
tables (`lineups`, `fixture_events`, `fixture_player_statistics`), all
populated by the existing sync pipeline under its existing guards. A page view
can never cause a provider request from the heatmap path; that decision lives
in `auto-sync.ts`, in one place, behind a cooldown and a quota floor.

The consequence is that the heatmap is exactly as good as what has been synced,
and the caption says which inputs it had.

## Two layers in the UI

`match-centre-tabs.tsx` builds a baseline with `buildFixtureHeatmaps` from the
lineups and events it already holds, and gates the tab on
`hasFixtureHeatmapContent` of **the same object it renders** — so availability
and content cannot disagree. `HeatmapView` then calls `loadFixtureHeatmaps`,
which returns a richer version that can see `lineups.grid` and
`fixture_player_statistics`.

The upgrade is strictly additive. `unavailable` (no richer version exists — a
signed-out reader, a fixture KIVO does not hold) renders nothing extra;
`error` renders one line saying so. Neither can empty a tab that was offered.

## `PositionalDataProvider` — still a pure seam

```ts
interface PositionalDataProvider {
  readonly name: string;
  getPlayerPositions(fixtureId: string, playerId: string): Promise<PositionalObservation[]>;
  getTeamPositions(fixtureId: string, teamId: string): Promise<PositionalObservation[]>;
}
```

**No implementation exists.** Nothing in KIVO can produce a
`PositionalObservation`, so `derivation: "tracked"` is currently unreachable —
and the tracked path is fully built and tested anyway, so connecting a real
vendor is a wiring change rather than a redesign. `buildFixtureHeatmaps` takes
an optional `observations` argument; the day a provider exists, it is passed,
the aggregator takes the tracked path automatically, and every caption changes
itself.

## What is still not buildable

- **True positional heatmaps**, until a tracking-data vendor is connected.
- **Pass maps, shot maps, xG-by-location.** All need per-event coordinates.
  Shot maps in particular are often assumed to be available because shot
  *counts* are — they are not the same thing.
- **Which flank a player occupied**, until the `grid` column direction is
  confirmed against a live key.
