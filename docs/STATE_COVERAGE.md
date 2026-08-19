# Loading, empty, error and partial-data states

The founding directive's Definition of Done lists four states, not one. A
feature is not finished because the happy path renders: it needs a loading
state, an empty state, an error state and a partial-data state, and each of
those has to be *true* — a state that says the wrong thing is worse than a
state that says nothing, because the user acts on it.

This document is the survey behind that claim for every route in `src/app/`,
the three questions each state was judged against, and what was changed.

---

## The four states, and the one that was missing

| State | Component | Says |
| --- | --- | --- |
| Loading | `<PageSkeleton>` + `<Skeleton>`, in each route's `loading.tsx` | "It's coming, and it will land *here*." |
| Empty | `<NoDataYet>` | "There is genuinely nothing, and here is why: KIVO builds coverage one competition at a time." |
| **Failed** | **`<LoadFailed>`** | **"We could not find out. Try again."** |
| Error (thrown) | `error.tsx` at `/`, `(app)`, `/admin` + `global-error.tsx` | "Something broke. Retry, go home, or tell us." |
| Not found | `not-found.tsx` at `/`, `(app)`, `/admin` | "This does not exist." |

`<LoadFailed>` is new, and it is the centre of this pass. Every list page in
KIVO was written the same way:

```ts
const { data } = await supabase.from("teams").select(...);
const rows = data ?? [];
if (rows.length === 0) return <NoDataYet … />;
```

`data ?? []` is where two different facts collapse into one. PostgREST returns
`{ data: null, error }` when a query fails, so a dropped connection, an expired
token or a statement timeout rendered the **empty** state — which in this
product says, in as many words, that KIVO has not synced this competition yet
and that *nothing is broken*. That sentence is false at exactly the moment
something is broken, and false in the most expensive direction: the reader
stops trying, because they have been told there is nothing to wait for.

The rule now lives in one place, `src/lib/query-result.ts`, and is under test:

- **`readList`** returns `{ failed, rows }`. A page renders `<LoadFailed>` on
  `failed` and `<NoDataYet>` on a genuinely empty `rows`. It does not throw — a
  browse page can keep its header and filters on screen while one section
  admits it could not load.
- **`readRow`** *throws* on failure and returns `null` only for a genuinely
  absent row. These lookups gate `notFound()`, and a failed read used to render
  "Offside. That doesn't exist." about a venue, a club or a manager that exists
  perfectly well. **A 404 is a claim about the world, not about the request**,
  and it must never be made on a guess.
- **`readOptionalRow`** returns `null` for both, having logged — for
  `generateMetadata`, where a failure must never take a page down.

The precedent was already in the codebase and simply had not been generalised:
`getPublicProfile` in `/u/[username]` refuses to collapse "RPC errored" into
"no such profile", for exactly this reason. Every failure is logged through
`logError` with a `query.<context>` tag, so a state a user can see is also one
an operator can find.

---

## The three questions

### 1. Does the skeleton match the geometry of what replaces it?

A skeleton is a promise about where things will be. Break it and the page jumps
when content lands, which is worse than showing nothing.

Two structural faults were found, both invisible to review:

**A `loading.tsx` covers its whole subtree.** Next resolves the *nearest*
`loading.tsx` above a segment, so `/profile/loading.tsx` was standing in for
`/profile/edit/name`, `/profile/avatar` and seven more. Opening "Change your
name" flashed a cover band, a 92px avatar, a stat rail and a tab bar at full
page width, then replaced all of it with a narrow column holding one text
field. `/settings/loading.tsx` did the same for its nine sections. Both now
have per-section skeletons built on one shared component each
(`<ProfilePageSkeleton>`, `<SettingsPageSkeleton>`).

**Containers had drifted from their pages.** Measured in Chromium at 390px:

| Container | Padding top | Stack gap | Padding bottom |
| --- | --- | --- | --- |
| `.kivo-page` (what the pages use) | 25.5px | 21.25px | 42.5px |
| the older ad-hoc column (what the skeletons used) | 34px | 25.5px | 34px |

So on `/settings`, `/social` and `/u/<handle>` the first block sat **8.5px too
low** and every gap after it was **4.25px too wide** — about **25px of
cumulative drift** on a header plus four blocks, all of it snapping shut the
moment content arrived. At 1280px the two containers agree except at the
bottom, so this was a phone-only defect: precisely the class of thing a
desktop-first check never sees. `/home` had `gap-8` against the page's `gap-6`,
and `/fantasy` was missing the `pb-28` that `FantasyBuilder` reserves for its
fixed save bar, so the page grew ~96px taller on arrival.

This is now enforced rather than remembered. `src/lib/page-container.test.ts`
reads every `loading.tsx` and its `page.tsx` out of `src/app/`, reduces each
container to the classes that actually place content, and fails the build if a
skeleton renders into a container its page never does — resolving through the
shell or component the page delegates to (`EntityListPage`,
`SettingsPageShell`, `AiChat`, `FantasyBuilder`). Verified in a browser as well
as in the test: every skeleton's computed box — width, padding, row gap,
max-width — is byte-identical to its page's at both 390px and 1280px.

Loading states also gained an accessible name. A screen of grey `<div>`s is
announced as nothing at all, so a slow route was simply a page that did not
respond. `<PageSkeleton>` carries `role="status"`, `aria-busy` and one
`sr-only` line naming what is loading ("Loading account settings"), and
`<Skeleton>` is now `aria-hidden` so forty unlabelled boxes are not read out.
The shimmer already honoured `prefers-reduced-motion` (confirmed: computed
`animation-name: none` under `reducedMotion: "reduce"`).

### 2. Does the empty state say something true and useful?

KIVO was already strong here, and the strength is worth naming: `<NoDataYet>`
does not say "No data". It names the thing, and then explains the product
position — coverage is built one competition at a time from a verified
provider, never scraped — and links to `/transparency`, which counts what
actually exists. That turns a wall of apparent emptiness into a stated intent.

The defect was never the wording. It was that the same wording was shown when
the read had failed, which is what `<LoadFailed>` now separates. `<LoadFailed>`
deliberately does *not* carry the coverage explainer: pointing somebody at
"exactly what KIVO has" answers a question they did not ask with a page that
cannot help them.

Two empty states that were shrugs were rewritten to say what fills them:
"No fixtures synced at this venue yet" now adds where they come from, and "No
badges earned yet" now says what earns one.

### 3. Does a partial-data state exist?

The charting layer is already the standard the directive asks for, and the fix
work here was to bring the data-read layer up to it rather than to change it:

- `SeriesChart` returns `null` below two points, centres a flat series instead
  of dividing by a zero span, and **steps rather than smooths** — because a
  smooth curve between two snapshots claims KIVO knows a value in between, and
  it does not.
- `SeasonFantasyArc` scales against the manager's own best gameweek, floors a
  scored zero at a visible sliver, and states plainly that there is no honest
  external maximum to compare against.
- `PostCard`'s poll bars render 0% rather than a fabricated split when the
  total is zero or the results are unavailable.
- The Match Centre's statistic comparison renders one flat neutral rail when a
  statistic is reported for only one side.

One real partial-data defect was found and fixed: `/u/<handle>` read a
profile's XP and badges with `?? 0` and `?? []`, so a failed read rendered
"**0 XP**" and "**No badges earned yet**" — two confident, wrong statements
about a real person's record. It now reports the failure for that section and
leaves the identity above it intact.

---

## The survey

`own` = its own `loading.tsx`. A path = the ancestor whose file it inherits.
Every route under `(app)` now resolves its own skeleton; before this pass,
seventeen of them inherited one shaped like a different page.

### `(app)` — the product

| Route | Loading | Error | Not found | Empty state | Failed state |
| --- | --- | --- | --- | --- | --- |
| `/home` | own | `(app)` | `(app)` | yes | — |
| `/live` | own | `(app)` | `(app)` | yes | — |
| `/matches` | own | `(app)` | `(app)` | yes | — |
| `/matches/[id]` | own | `(app)` | `(app)` | yes | — (contended — see below) |
| `/social` | own | `(app)` | `(app)` | yes (per tab) | yes |
| `/social/compose` | **own (new)** | `(app)` | `(app)` | n/a | — |
| `/predictions` | own | `(app)` | `(app)` | yes | — |
| `/predictions/mine` | own | `(app)` | `(app)` | yes | — |
| `/profile` | own | `(app)` | `(app)` | yes | — |
| `/profile/edit` | **own (new)** | `(app)` | `(app)` | yes | — |
| `/profile/edit/name` | **own (new)** | `(app)` | `(app)` | n/a | — |
| `/profile/edit/username` | **own (new)** | `(app)` | `(app)` | n/a | — |
| `/profile/edit/bio` | **own (new)** | `(app)` | `(app)` | n/a | — |
| `/profile/edit/country` | **own (new)** | `(app)` | `(app)` | n/a | — |
| `/profile/avatar` | **own (new)** | `(app)` | `(app)` | n/a | — |
| `/profile/background` | **own (new)** | `(app)` | `(app)` | n/a | — |
| `/profile/club` | **own (new)** | `(app)` | `(app)` | n/a | — |
| `/profile/season` | **own (new)** | `(app)` | `(app)` | yes | — |
| `/profile/following` | own | `(app)` | `(app)` | yes | — |
| `/saved` | own | `(app)` | `(app)` | yes | — |
| `/rewards` | own | `(app)` | `(app)` | yes | — |
| `/search` | **own (new)** | `(app)` | `(app)` | yes | yes |
| `/discover` | own | `(app)` | `(app)` | yes | — |
| `/teams` | own | `(app)` | `(app)` | yes | **yes (new)** |
| `/teams/[id]` | own | `(app)` | `(app)` | yes | **yes (new)** |
| `/teams/compare` | own | `(app)` | `(app)` | yes | — |
| `/players` | own | `(app)` | `(app)` | yes | **yes (new)** |
| `/players/[id]` | own | `(app)` | `(app)` | yes | — (contended) |
| `/players/compare` | own | `(app)` | `(app)` | yes | — |
| `/leagues` | own | `(app)` | `(app)` | yes | **yes (new)** |
| `/leagues/[id]` | own | `(app)` | `(app)` | yes | **yes (new)** |
| `/managers` | own | `(app)` | `(app)` | yes | **yes (new)** |
| `/managers/[id]` | own | `(app)` | `(app)` | yes | **yes (new)** |
| `/venues` | own | `(app)` | `(app)` | yes | **yes (new)** |
| `/venues/[id]` | own | `(app)` | `(app)` | yes | **yes (new)** |
| `/transfers` | own | `(app)` | `(app)` | yes | **yes (new)** |
| `/transfers/[id]` | own | `(app)` | `(app)` | yes | — (contended) |
| `/u/[username]` | own | `(app)` | `(app)` | yes | **yes (new)** |
| `/fantasy` | own | `(app)` | `(app)` | yes | — |
| `/fantasy/browse` | **own (new)** | `(app)` | `(app)` | yes | yes |
| `/notifications` | own | `(app)` | `(app)` | yes | — |
| `/transparency` | own | `(app)` | `(app)` | n/a — the page *is* the counts | — |
| `/ai` | own | `(app)` | `(app)` | yes | — |
| `/news` | own | `(app)` | `(app)` | Coming Soon | n/a |
| `/highlights` | own | `(app)` | `(app)` | Coming Soon | n/a |
| `/settings` | own | `(app)` | `(app)` | n/a | — |
| `/settings/account` | **own (new)** | `(app)` | `(app)` | n/a | — |
| `/settings/clubs` | **own (new)** | `(app)` | `(app)` | yes | — |
| `/settings/avatar` | **own (new)** | `(app)` | `(app)` | n/a | — |
| `/settings/appearance` | **own (new)** | `(app)` | `(app)` | n/a | — |
| `/settings/notifications` | **own (new)** | `(app)` | `(app)` | n/a | — |
| `/settings/privacy` | **own (new)** | `(app)` | `(app)` | yes | — |
| `/settings/data` | **own (new)** | `(app)` | `(app)` | n/a | — |
| `/settings/help` | **own (new)** | `(app)` | `(app)` | n/a | — |
| `/settings/delete-account` | **own (new)** | `(app)` | `(app)` | n/a | — |

### `/admin`

| Route | Loading | Error | Not found | Empty state | Failed state |
| --- | --- | --- | --- | --- | --- |
| `/admin` | own | `/admin` | **`/admin` (new)** | yes | — |
| `/admin/moderation` | `/admin` | `/admin` | `/admin` | yes | — |
| `/admin/support` | `/admin` | `/admin` | `/admin` | yes | — |
| `/admin/users` | `/admin` | `/admin` | `/admin` | yes | — |
| `/admin/data-health` | `/admin` | `/admin` | `/admin` | yes | — |
| `/admin/design` | `/admin` | `/admin` | `/admin` | n/a — static reference | n/a |

`/admin` had no `not-found.tsx`, so a mistyped admin URL fell through to the
root 404 — which renders above `admin/layout.tsx` and therefore without the
admin sidebar or drawer, stranding an operator outside the section they were
working in.

The five sub-pages share `/admin/loading.tsx` deliberately: they are one
consistent "heading plus stacked panels" shape inside the admin layout's own
padded `<main>`, so one skeleton is honest for all of them.

### Public surface

| Route | Loading | Error | Not found | Empty state | Failed state |
| --- | --- | --- | --- | --- | --- |
| `/` | — | `/` | `/` | yes | — |
| `/about` | — | `/` | `/` | n/a — static copy | n/a |
| `/terms` | — | `/` | `/` | n/a | n/a |
| `/privacy` | — | `/` | `/` | n/a | n/a |
| `/support` | — | `/` | `/` | n/a — a form | handled in-form |
| `/sign-in` | — | `/` | `/` | n/a | handled in-form |
| `/sign-up` | — | `/` | `/` | n/a | handled in-form |
| `/onboarding` | — | `/` | `/` | n/a | handled in-flow |

No `loading.tsx` on any of these, and that is the right call rather than an
omission: each is a single server render with no data fan-out, reached by a
full document load or from the landing page, and every one of them already
reports its own failures inside the form or flow it *is*. A skeleton here would
flash a shape for less time than it takes to read.

---

## Adding a route

1. Write `loading.tsx` next to `page.tsx`. It must use `<PageSkeleton>` and the
   same container the page renders into — `src/lib/page-container.test.ts`
   fails the build otherwise. Give it a `label` naming what is loading.
2. Read lists through `readList` and single rows through `readRow`
   (`src/lib/query-result.ts`). Never `data ?? []`.
3. Branch three ways, not two: `failed` → `<LoadFailed>`, empty → `<NoDataYet>`
   with a sentence saying what fills it, otherwise the content.
4. If the page computes a ratio, a percentage or a bar, decide what it renders
   when one side is missing — and make that a visible neutral state, never a
   confident 0 or a 100/0 split.

---

## Not fixed here — owned by other agents

Reported rather than edited, per the file ownership on this branch:

- **`src/app/(app)/matches/[id]/page.tsx`** (actively contended) — two
  `{ data: fixture }` reads without `error`, both gating `notFound()`. A failed
  read on the highest-traffic detail page in the product renders "that doesn't
  exist" about a real fixture. One-line fix each with `readRow`.
- **`src/app/(app)/players/[id]/page.tsx`** and
  **`src/app/(app)/transfers/[id]/page.tsx`** — same pattern, same one-line
  fix; both had uncommitted changes from another agent when this pass ran.
- **`src/components/predictions/prediction-card.tsx`** — `pct()` divides by
  `total` with no zero guard on the path where every count is zero.
