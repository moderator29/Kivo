# KIVO UI primitives

The shared components every surface builds from, and the short list of things
nobody should hand-roll again.

This is a contract, not a suggestion. The deployed product was described by the
founder as looking "like an AI-generated dashboard, not a real football
product", and the diagnosis was not that KIVO lacked a design system —
`src/lib/design-system.ts` has held one for a long time. It was that six
surfaces each solved the same problem their own way. A rule you have to
remember loses to a component you can import, so these exist to make obeying
the system the path of least resistance.

**Read `src/lib/design-system.ts` first.** It carries the container ladder
(`CONTAINER_ROLES`), the four density rules, the type scale, the surface tiers
and the two motion vocabularies. Everything below is those rules, made
importable.

---

## 1. `SectionTabs` — the one tab bar

`src/components/ui/section-tabs.tsx`

The founder's most specific instruction about the entire product was about this
control. Match Centre, Team, Player, Competition and Social all render section
tabs. **There is one implementation and this is it.** Do not build a second.

### Exports

```ts
import {
  SectionTabs,
  TabPanel,
  useTabParam,
  tabSlug,
  type SectionTab,
} from "@/components/ui/section-tabs";
```

### The tab

```ts
export type SectionTab<T extends string = string> = {
  id: T;                 // stable, slug-safe: "lineups", "standings"
  label: string;         // what a fan calls it. Never a slug, never an internal name.
  count?: number;        // a REAL count. Omit rather than pass 0.
  icon?: LucideIcon;     // optional leading glyph, drawn at 14px by <Icon>
};
```

### `PanelTabs` — the rail for a server-rendered page

`@/components/ui/panel-tabs` — `PanelTabs`, `type PanelTab`.

`SectionTabs` is controlled and `useTabParam` is a hook, so neither can be
called from a Server Component. Most of KIVO's tabbed pages ARE server
components whose panels are server-rendered — a league table, a squad list, a
fixture list, each with its own data read. `PanelTabs` is the glue: every panel
arrives as an already-rendered `ReactNode`, and the only thing shipped to the
browser is the rail itself. A league table stays server-rendered and costs zero
client JavaScript.

```tsx
const tabs: PanelTab[] = [
  { id: "table", label: "Table", content: <StandingsTable … /> },
  { id: "fixtures", label: "Fixtures", count: 12, content: <MatchList … /> },
];

<PanelTabs tabs={tabs} ariaLabel="Competition sections" idPrefix="competition" />
```

It handles two cases callers kept getting wrong: **zero tabs renders nothing**,
and **one tab renders its panel with no rail** — a rail with a single
destination is a label the reader cannot act on. Its Suspense fallback draws
the real rail with the first tab selected, so the boundary costs no spinner and
no reflow.

`PanelTab` omits `icon` for the reason immediately below.

**This component exists because it was written twice.** The club/player pages
and the competition page each grew their own version of this glue on the same
night, independently, and both authors were right that it was too thin to
extract — which is exactly how a codebase ends up with two of something. The
props that were "missing" were `ariaLabel` and `idPrefix`, and they cost four
lines. If you are about to write a third, add a prop here instead.

**`icon` cannot cross a server/client boundary.** A `LucideIcon` is a function
component, and a Server Component cannot pass a function as a prop into a Client
Component — so a server-rendered page that builds its `tabs` array server-side
must omit `icon` entirely. This is not a bug in the rail and there is no way to
fix it in the rail; it is React's serialization boundary. It surfaces at build
time with a message about functions not being serializable, which is a confusing
place to meet it for the first time.

Two ways out, in order of preference:

1. **Omit the icon.** A tab label is a word a fan reads; the glyph is decoration
   and most rails read better without it. This is the default for a reason.
2. **Build the `tabs` array inside the Client Component** that owns the rail,
   where the icon is just an import. Pass the server's data in as plain values
   and let the client assemble the tabs.

Do not reach for a third option — a string icon name resolved through a lookup
map re-introduces exactly the stringly-typed indirection the `LucideIcon` type
exists to prevent, and it fails at runtime rather than at build time.

There is deliberately **no `href`**. The rail switches panels within one page;
it does not navigate. A row of links between different routes is a nav, not a
tablist, and wants `<Link>`s — using a tablist for it would announce "tab 3 of
7" for something that unloads the page.

There is also deliberately **no `disabled`**. A tab whose data may never exist
should be **omitted from the array entirely**. Greying one out collapses two
different facts — "not published yet" and "this competition never publishes
this" — into one dead control the fan can only interpret as broken. Build the
array from what actually has content:

```tsx
const tabs: SectionTab<Tab>[] = [
  { id: "overview", label: "Overview" },
  ...(lineups.length ? [{ id: "lineups", label: "Line-ups" } as const] : []),
  ...(groups.length ? [{ id: "standings", label: "Standings" } as const] : []),
];
```

### The rail

```tsx
<SectionTabs
  tabs={tabs}
  value={active}                     // controlled. You own the selected id.
  onChange={setActive}
  ariaLabel="Match centre sections"  // names the rail, not the page
  idPrefix="match-centre"            // namespaces element ids; must be unique per rail
  tone="underline"                   // "underline" (default) | "pill"
  sticky                             // optional: sticks under the app header
  bleed                              // optional: runs to the screen edge on mobile
/>
```

It is **controlled**, always. The component holds no selection state of its
own, because five surfaces resolve their default tab differently (Match Centre
collapses empty sections; a competition's default depends on whether the season
has started) and a component that guessed would be wrong on most of them.

`tone`:

- **`underline`** — the page-level rail. The *sections of a screen*. Sits under
  the page header with a hairline beneath it. This is the default and it is
  what the founder asked for.
- **`pill`** — a *filter inside a section*: a competition chooser above a
  fixture list, a season chooser above a squad.

Anything smaller than either of those is a **`<Segmented>`**
(`src/components/ui/segmented.tsx`), not a tab bar. `Segmented` is a
`radiogroup` that reshapes content already on screen; `SectionTabs` is a
`tablist` that owns panels and the `aria-controls` wiring between them. They
look similar and they are not interchangeable — see the note at the top of each
file.

### The panel is yours

`SectionTabs` renders no panel. It knows nothing about what a section contains
— which is what lets a competition put several standings groups in one panel
and Social put an infinite feed in another. Wrap your content in `<TabPanel>`
so the accessibility wiring is built rather than retyped:

```tsx
<TabPanel idPrefix="match-centre" tab="lineups" active={active === "lineups"}>
  <TeamSheet … />
</TabPanel>
```

The `idPrefix` must match the rail's. That pair is the entire reason a screen
reader says "Line-ups, tab 3 of 7" rather than reading a row of unrelated
buttons, and it breaks silently when one of the two strings drifts.

### Put the tab in the URL

```tsx
const [active, setActive] = useTabParam({
  tabs: ["overview", "lineups", "standings"] as const,
  legacy: { "team-sheet": "lineups" },  // slugs people have already shared
});
```

`useTabParam` resolves through `resolveTabFromSlug`
(`src/lib/football/match-timeline.ts`) — the same resolver, not a copy — so a
renamed slug still works and a slug naming a tab that is not currently on
screen falls back to the first visible one instead of leaving nothing
highlighted. It writes with `window.history.pushState`, so back/forward work
and changing a tab costs no server round-trip, and it clears the param on the
first tab: the canonical URL of a match is the match, not the match's default
section.

It calls `useSearchParams`, so it needs a Suspense boundary above it like any
other caller.

### What you get for free

Horizontal scroll with momentum and proximity snapping; per-edge fade masks
driven by real scroll position (a 3-tab rail with nothing to scroll is not
ghosted for decoration); the active tab scrolled into view on mount and on
change; a single indicator that *moves* between tabs, measured inside the
scroll content so a change that also scrolls cannot make it fly; roving
`tabIndex` so the rail is one tab stop; arrow keys and Home/End; a focus ring
drawn inside the control because a horizontal scroller clips an outset one;
44px targets; `prefers-reduced-motion` honoured throughout.

Verified at **3 tabs and 12**, at 390px and 1280px, dark and light.

### Never

- Never wrap the rail, add a dropdown, or shorten a label to make tabs fit.
  It scrolls. That is the whole design.
- Never render a disabled tab. Omit it.
- Never put a count on a tab you have not actually counted.

---

## 2. Sections, lists and surfaces

The founder's "looks like an AI-generated dashboard" is, structurally, a note
about these. Every screen was a stack of glass cards of roughly equal weight,
so a page had no shape: a squad list, the next fixture and a settings toggle
all arrived as the same box.

**Do not turn every element into a card.** `CONTAINER_ROLES` in
`design-system.ts` names five containers and the choice between them is the
single highest-leverage decision on any screen.

### `<Section>` — `src/components/ui/section.tsx`

A titled region of a page. Heading, optional description, optional single
action on the right, body.

```tsx
<Section title="Squad" description="Senior players registered for the season"
         action={<Link href="…">See all</Link>}>
  …
</Section>
```

**It has no surface by default, and that is the point.** `<ListSurface>` or
`<StatGrid>` inside it bring their own container when the content is a list or
a grid; prose does not need one, and wrapping it in glass is how the dashboard
look happens. `surface="panel"` exists for a region that is genuinely one unit
of mixed content — reach for it rarely.

`as="h3"` for a section nested inside another. A skipped heading level is the
most common way a well-built page still reads as a jumble to a screen reader.

Spacing between sections belongs to `.kivo-page`, never to a section's own
margin. Two competing rhythms on one page is `DENSITY_RULES`' "vertical rhythm
is coarse, not fine", broken.

`<FieldLabel>` ships alongside it: the only sanctioned 11px in the app, already
uppercase and tracked, so nobody reaches for `text-[10px]` because it looked
close enough.

### `<ListSurface>` / `<ListRow>` — `src/components/ui/list-surface.tsx`

**One surface, hairline-divided rows.** Never a card per item.

```tsx
<ListSurface>
  <ListRow href={`/players/${p.id}`} chevron
           leading={<PlayerAvatar … />}
           title={p.name} subtitle="Forward · 7" trailing={p.appearances} />
</ListSurface>
```

Ten items as ten glass cards is ten borders, ten shadows and ten backdrop
blurs where there should be one, and it is why a phone fit five items where a
real football app fits ten. `CONTAINER_ROLES.row` has always said so; the code
had drifted off it.

- `inset` when the list already sits inside a panel. A card inside a card is
  the nesting `DENSITY_RULES` forbids.
- `as="ol"` when the order is a fact about the data (a table, a scorer list).
- `href` makes the **whole row** the target — one tab stop, one accessible
  name. Three links inside a row means three tab stops per item.
- `chevron` only with an `href`. A chevron on a row that does not navigate is
  a lie.

**Fixtures use `<MatchList>` / `<MatchListRow>`**
(`src/components/matches/match-list.tsx`), not this. That row has a time rail
and two stacked clubs and is genuinely denser. It is the one fixture row in the
app — do not build a fifth.

### `<StatBlock>` / `<StatGrid>` — `src/components/ui/stat-block.tsx`

```tsx
<StatGrid columns={3}>
  <StatBlock label="Played" value={played} />
  <StatBlock label="Won" value={won} tone="accent" />
</StatGrid>
```

Value over label, because a stat is read value-first. One surface for the grid,
not one card per number — six short numbers in six glass boxes is the densest
version of the card problem.

**There is no null handling, deliberately.** A caller with no value must not
render the block. A grid of "—" is nothing dressed as data. If the whole grid
would be empty, that is an `<EmptyState>`. `tone="accent"` marks at most one
per grid.

`StatBlock` never formats — a formatter guessing at units is a fabricated fact.

---

## 3. Skeletons — `src/components/ui/skeletons.tsx`

**A load must never end in a reflow.** A skeleton is a promise about where
things will be, and the visible way to break it is to get the geometry wrong:
content lands, the page jumps. That is worse than showing nothing, because
nothing at least does not lie about the layout.

| Use | For |
| --- | --- |
| `<PageHeaderSkeleton>` | `<PageHeader>`'s `h1` + subtitle |
| `<SectionTabsSkeleton>` | the tab rail |
| `<SectionHeadingSkeleton>` | a `<Section>` whose title is itself loaded |
| `<ListSkeleton>` | `<ListSurface>` + `<ListRow>` |
| `<TableSkeleton>` | a standings table, with its position rail and numeric columns |
| `<SquadGridSkeleton>` | a squad as tiles |
| `<StatGridSkeleton>` | `<StatGrid>` |
| `<PostSkeleton>` | a post or an article |
| `<MatchListSkeleton>` | fixtures — lives in `match-list.tsx`, beside its row |

Render them inside `<PageSkeleton>` (`page-skeleton.tsx`), which announces the
wait once with a name and passes the page's real container. The bars are
`aria-hidden`; forty unlabelled boxes read to a screen reader is worse than the
silence it replaced. The shimmer turns itself off under
`prefers-reduced-motion`.

**Match the props to the real component.** `<ListSkeleton leading="circle"
subtitle trailing>` must describe the row that is actually coming. A skeleton
with a leading avatar in front of a list that has none is a reflow with extra
steps.

A section with a *static* title should render the real title and skeleton only
its body. A heading that flickers from grey bar to text on every load is
noisier than one that never moved.

---

## 4. Empty and error states

Three different facts, three different components. Collapsing them is what made
the product feel broken rather than early.

| Fact | Component |
| --- | --- |
| There is genuinely nothing yet | `<EmptyState>` — `empty-state.tsx` |
| One panel could not be read | `<InlineError>` — `empty-state.tsx` |
| The failed read *is* the page | `<LoadFailed>` — `load-failed.tsx` |
| The feature is not built | `<ComingSoon>` — `coming-soon.tsx` |

`<NoDataYet>` is `<EmptyState>` under its old name and renders the same frame.
New code imports `EmptyState`.

### The rule for the words

**Say what the fan can expect or act on. Never say what failed. Never use an
internal word.** No sync, no provider, no quota, no API, no ids, no "loading".
Those belong in Admin and nowhere else — a previous pass swept 55 files for
them, and they must not come back.

```
Good: "Line-ups are published about an hour before kick-off."
Good: "No goals yet."
Good: "This club hasn't played a competitive match this season."
Bad:  "No data available."         — says nothing
Bad:  "Lineups not yet synced."    — internal, and blames the machinery
Bad:  "Failed to load lineups."    — that is an error, not an empty state
```

Give it an `action` where a real next step exists. An empty state that offers a
way onward stops being a dead end, which is the whole difference between a
considered one and an apology.

`tone="section"` for one empty region beside content that loaded; `tone="page"`
only when the empty thing IS the page. `page` inside a section leaves a hundred
vertical pixels of nothing in the middle of a working screen.

`<InlineError what="Stats" />` is one hairline row inside the space the panel
would have occupied. A match with a healthy timeline should not give a third of
the screen to the fact that one panel is missing — and a failure that reflows
the page is a failure twice.

**Never fabricate football data.** No placeholder stats, no invented ratings, no
example scores — not in an empty state, not in a skeleton, not in a demo.

---

## 5. Page shell and navigation

| Piece | Where |
| --- | --- |
| Page container | `.kivo-page` in `globals.css` (`--wide`, `--narrow`) |
| Page opening | `<PageHeader>` — `src/components/layout/page-header.tsx` |
| Back | `<BackLink>` / `<RouteBackLink>` — `src/components/ui/back-link.tsx` |
| Top bar | `<TopBar>` — `src/components/layout/top-bar.tsx` |
| Bottom bar (mobile) | `<MobileBottomNav>` — `src/components/layout/mobile-bottom-nav.tsx` |
| Shell | `<AppShell>` / `<AppChrome>` — `src/components/layout/` |

`<PageHeader back />` works its destination out from the route. **Never
hand-roll a back control** — `docs/BACK_NAVIGATION.md` is the contract, and it
is one control precisely so that arriving from a shared link, from a
notification, or from the list you were just on all behave correctly.

`--kivo-header-h` is the top bar's height. Anything sticking under the header —
`<SectionTabs sticky>` is the first — offsets by that variable rather than
guessing, and `<TopBar>` sets its own `min-height` from it so the two cannot
drift.

**Mobile is not a shrunk desktop.** The bottom bar floats above the content and
`<AppChrome>`'s `<main>` clears it with
`pb-[calc(env(safe-area-inset-bottom)+6rem)]` — the inset is part of the number
because a flat 6rem is about 10px short on a notched phone, which puts the last
row of every list under the bar. Any new fixed chrome does the same arithmetic.

---

## The short version

- One tab bar: `<SectionTabs>`.
- One fixture row: `<MatchListRow>`.
- One list container: `<ListSurface>`.
- One back control: `<BackLink>`.
- One page opening: `<PageHeader>`.
- One focus ring: `.kivo-focus`.
- One icon stroke scale: `<Icon>`.

If you are about to write a second one of anything on that list, the primitive
is probably missing a prop. Add the prop.
