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

*(Landing in the same branch — see the commit that follows this one.)*

## 3. Skeletons

*(Landing in the same branch — see the commit that follows this one.)*

## 4. Empty and error states

*(Landing in the same branch — see the commit that follows this one.)*
