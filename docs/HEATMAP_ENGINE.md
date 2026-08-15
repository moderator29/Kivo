# KIVO Heatmap Engine

Sources:
- `src/lib/football/positional-types.ts` — the `PositionalDataProvider` seam
- `src/lib/football/heatmap-engine.ts` — `HeatmapEngine` (unit tests:
  `heatmap-engine.test.ts`)
- `src/components/matches/heatmap-view.tsx` — `HeatmapView`, the UI

## The gap this addresses

Confirmed in `BUILD_STATUS.md`: API-Football's free tier reports **no
positional or touch coordinate data at all**. Heatmaps are, today,
genuinely impossible to render from real data. The founder's directive was
explicit: KIVO owns the *visualization engine*; the *positional data itself*
must come from a real, connected provider — and none exists yet. This pass
builds the engine and the seam for that future provider, and a UI that is
honest about the gap in the meantime, rather than a fake heatmap standing
in for a feature that doesn't have real data behind it yet.

## `PositionalDataProvider` — a pure seam, not a live integration

```ts
interface PositionalDataProvider {
  readonly name: string;
  getPlayerPositions(fixtureId: string, playerId: string): Promise<PositionalObservation[]>;
  getTeamPositions(fixtureId: string, teamId: string): Promise<PositionalObservation[]>;
}
```

**No current `FootballDataProvider` implementation — not API-Football, not
the dev-only mock — implements this.** It is not wired to anything live. It
exists purely so a future real positional/tracking-data vendor has a
concrete, real contract to build against, and so `HeatmapEngine` has a
stable input shape to consume, without either side needing a redesign once
that vendor is connected.

It is deliberately provider-agnostic: nothing in `positional-types.ts`
names or shapes itself after any specific vendor, past or present. The
`source` field on every observation is free text specifically so adding a
real provider later never requires touching this file.

```ts
interface PositionalObservation {
  playerId: string;
  matchId: string;
  timestamp: string;      // ISO 8601
  x: number;               // 0-100, canonical pitch coordinate system
  y: number;                // 0-140, canonical pitch coordinate system
  eventType: "touch" | "pass" | "shot" | "tackle" | "carry" | "duel" | "reception" | "unknown";
  confidence: number | null; // real provider confidence, or null — never invented
  source: string;           // free text, identifies the feed/vendor
}
```

## `HeatmapEngine` — the part KIVO owns outright

Pure, framework-free, and fed only normalized `PositionalObservation[]`. It
buckets observations into a grid on a canonical coordinate system and
reports both raw counts and normalized density per zone:

```ts
const engine = new HeatmapEngine(cols = 6, rows = 7);
const result = engine.build(observations, { playerId, matchId });
// result.hasData: boolean
// result.grid: { cols, rows, zones[], totalObservations, maxZoneCount }
// result.sourcesUsed: string[]
```

Key properties, all covered by `heatmap-engine.test.ts`:

- **`PITCH_DIMENSIONS = { width: 100, height: 140 }`** is chosen to exactly
  match the `viewBox` of `PitchLines` (`src/app/(app)/fantasy/pitch.tsx`),
  the pitch graphic `LineupPitch` and `HeatmapView` both already use — a
  heatmap grid overlays that exact same pitch with no coordinate transform.
- **Out-of-bounds observations are skipped, not clamped** into the nearest
  edge zone — clamping would misrepresent a coordinate the provider itself
  reported outside the canonical pitch as a real edge-of-pitch touch.
- **An empty input produces a full grid of real zeros**, not an error and
  not an omitted grid — `hasData: false` is the explicit signal a consumer
  checks, rather than inferring "no data" from an empty array some other
  way.
- **Zero import from, or reference to, `premium-stats.ts`** (the
  Sportmonks-tied module a sibling work stream removes this same pass) or
  any Sportmonks-specific naming, anywhere in this engine or the seam above
  it. This is a clean-room, provider-agnostic implementation.

## Today, in production: always empty, and that's correct

No `PositionalDataProvider` is connected. Every real call site passes an
empty `observations` array. `HeatmapEngine.build([])` returns
`hasData: false`. This is **the expected, correct state right now** — not a
bug to special-case around, and not a reason to fall back to a plausible-
looking fake grid. `HeatmapView` renders this state deliberately.

## `HeatmapView` — the deliberate empty state

```tsx
<HeatmapView observations={observations} subjectLabel="Erling Haaland" />
```

- When `observations` produces real data, it renders an SVG density grid —
  cyan-tinted rectangles at `zone.density` opacity — over the same
  `PitchLines` background `LineupPitch` uses, so it reads as the same
  visual family rather than a new, unrelated graphic.
- When it doesn't (today, always), it renders a polished, intentional
  "**Positional data unavailable for this match**" card: an icon, a plain-
  language explanation that this is expected rather than broken, framed the
  same `kivo-glass` way as every other empty state in the app (see
  `EmptyState` in `match-centre-tabs.tsx` for the established pattern this
  follows). Per the founder's explicit request, this is designed to look
  complete on purpose — a feature that's honestly unavailable, not a
  feature that's broken.

## Why it isn't wired into Match Centre yet

The task asked for the `HeatmapView` component to exist and behave
correctly in both states, reusing `LineupPitch`'s visual language — it did
not ask for a new Match Centre tab. Since `HeatmapEngine` always receives
an empty array in production today, wiring it into Match Centre right now
would only ever show the empty state, which doesn't validate anything
about the real-data path. `RECOMMENDATIONS.md` logs adding a "Heatmap" tab
to `match-centre-tabs.tsx` as the natural next step once (a) a real
`PositionalDataProvider` implementation exists, or (b) product wants the
honest "unavailable" state visible on that surface today, whichever comes
first — either is a small, low-risk addition once decided, since the
component itself is already fully built and tested.
