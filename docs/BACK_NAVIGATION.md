# Back navigation

Every screen in KIVO you can tap *into* has one way back out, and it is the
same control everywhere: `<BackLink>` in `src/components/ui/back-link.tsx`.

This document is the survey behind that claim — all sixty-nine routes in
`src/app/`, which of three categories each falls in, and where its back control
lands. It is checked against the filesystem, not from memory: every `page.tsx`
under `src/app/` has a row below. It is
the reference for adding the next route: decide the category, and the wiring
follows from it with nothing new to design.

---

## The three categories

**A — Root.** A primary destination: the five tabs in the bottom bar (Live,
Matches, Social, Predictions, Profile) plus `/home`, the dashboard they sit
under, and `/`, the public landing page. These get **no** back control. You do
not arrive at a root from somewhere in particular; you switch to it. A back
arrow on a root is a control that cannot mean anything, and every one of them
makes the ones that *do* mean something cheaper.

**B — Inner page.** Anything reached by tapping into something: a fixture, a
player, a team, a competition, a venue, a manager, a transfer, a settings
section, the composer, AI Copilot, an admin sub-page, the legal pages, the auth
screens. These get a back control, always, in the same place.

**C — Surface with its own dismiss.** Overlays and flows that already have a way
out — the nav drawer, bottom sheets, the command palette, the error and
not-found screens, onboarding. These are listed here and deliberately left
alone, with the reason recorded, so nobody adds a second control that competes
with the first.

The rule that splits A from B inside the app is mechanical rather than a
hand-kept list: `isTabRoute()` in `src/lib/route-class.ts` matches exactly six
paths and everything else is an inner page. A route added anywhere in the
product is an inner page by default, which is the safe direction for this rule
to fail in — a back control that was not needed is noise, a missing one is a
dead end.

---

## How the control behaves

`<BackLink>` is a real `<Link href={parent}>` whose click is intercepted, in
that order, and the order is the whole point.

| Situation | What happens | Why |
| --- | --- | --- |
| The user tapped in from another KIVO screen | `router.back()` | Returns the exact list, tab and scroll position they left. Next restores scroll on a history pop and cannot restore it on a fresh push to the same URL. |
| The user opened a shared link, a notification, a bookmark, or a new tab | Navigates to the declared parent | There is no KIVO page behind them. `router.back()` would either do nothing or walk them out of the product entirely. |
| JavaScript has not loaded, or is off | Navigates to the declared parent | The `href` is server-rendered. The control works on first paint. |
| Cmd/Ctrl/Shift-click, middle-click | Browser default | It is a link, so it behaves like one: new tab, new window, copyable URL. |

**Telling those two apart** is the part with no browser API behind it.
`window.history.length` counts other sites' entries too, so it answers "yes, go
back" to somebody who arrived from a WhatsApp link — and `router.back()` then
returns them to WhatsApp. `document.referrer` is empty under most referrer
policies. Next's router (checked against
`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md`
for the version in this repo) exposes `back`, `forward`, `push`, `replace`,
`refresh`, `prefetch` and `bfcacheId`, and no "can I go back".

So KIVO counts its own navigations, in `src/hooks/use-in-app-history.ts`:

- a pathname change that was not a history traversal → one entry pushed;
- a `popstate` → one entry consumed;
- the count starts from `PerformanceNavigationTiming.type` — a `navigate` load
  is a new run from outside and starts at zero even if this tab held a KIVO
  session earlier, while a `reload` or a `back_forward` restore lands on an
  entry whose stack is intact and keeps the stored count.

The counter is conservative by construction. A forward press is a `popstate`
too and cannot be told apart from a back press by the event alone, so it is
counted as a pop. **Under-counting costs one push to the parent; over-counting
would strand somebody outside KIVO**, so every ambiguity resolves that way. The
arithmetic is pure and under test in `src/lib/back-navigation.test.ts`.

It is deliberately *not* stored in `window.history.state`, which would be the
textbook place for it: Next's App Router rewrites the current entry's state on
every commit (the `appRouterState` effect in
`node_modules/next/dist/client/components/app-router.js` builds a fresh
`{ __NA, __PRIVATE_NEXTJS_INTERNALS_TREE }` and `replaceState`s it), and child
effects run before parent effects, so a marker written from a component would be
wiped by the very next commit.

`<BackNavigationTracker />` mounts the counter once per shell — the app shell,
the admin layout, the marketing shell — so navigations between screens that have
*no* back control (`/home` → `/matches`) are still counted, and the fixture page
you open next pops back to the list position you left rather than pushing a
fresh one.

### Accessibility

- The visible text names the **destination** ("Matches"), so you can read the
  control and know whether pressing it is what you want.
- The accessible name names the **direction** as well ("Back to Matches"), so it
  is not just another link to Matches in the reading order. The visible text
  stays inside the accessible name, which is what WCAG 2.5.3 (Label in Name)
  requires so a voice-control user can still say "click Matches".
- 44px minimum target (`min-h-11`).
- Keyboard-reachable with no `tabIndex` of KIVO's own, because it is an anchor.
- Focus ring is `.kivo-focus` — `outline: 2px solid var(--ring)`, and `--ring` is
  the accent at 60%, which is the same value as the `focus-visible:ring-accent/60`
  written out longhand elsewhere in the codebase.
- The only motion is the press scale, and it is `motion-safe:` only. The root
  layout's `<MotionConfig reducedMotion="user">` covers `motion/react`
  components; a CSS transform is not one, so it declares its own respect.

### Where the destination comes from

`backTargetFor()` in `src/lib/route-class.ts`, in two steps: an explicit parent
for the handful of routes whose real parent is not their URL prefix, then a walk
up the path to the nearest ancestor the product has a name for. Labels are read
from `NAV_ITEMS` and `SETTINGS_SECTIONS` — the same maps the nav renders from —
so renaming a section renames every back control pointing at it. `/home` is the
floor, so no back control can be a dead end.

---

## The survey

### `(app)` — the product, behind the auth gate

Chrome is decided in `src/components/layout/app-chrome.tsx`. Inner pages here
render with **no bottom bar and no top bar**: the back control in
`FocusHeader` is the only chrome they get, which is the founder's rule (AI
Copilot is the reference example) and the reason this control matters more here
than anywhere else.

| Route | Category | Decision | Back lands on |
| --- | --- | --- | --- |
| `/home` | A · root | No back control | — |
| `/live` | A · root | No back control | — |
| `/matches` | A · root | No back control | — |
| `/social` | A · root | No back control | — |
| `/predictions` | A · root | No back control | — |
| `/profile` | A · root | No back control | — |
| `/ai` | B · inner | `FocusHeader` | Home |
| `/discover` | B · inner | `FocusHeader` | Home |
| `/fantasy` | B · inner | `FocusHeader` | Home |
| `/fantasy/browse` | B · inner | `FocusHeader` | Fantasy |
| `/highlights` | B · inner | `FocusHeader` | Home |
| `/leagues` | B · inner | `FocusHeader` | Discover |
| `/leagues/[id]` | B · inner | `FocusHeader` | Leagues |
| `/managers` | B · inner | `FocusHeader` | Home |
| `/managers/[id]` | B · inner | `FocusHeader` | Managers |
| `/matches/[id]` | B · inner | `FocusHeader` | Matches |
| `/news` | B · inner | `FocusHeader` | Home |
| `/notifications` | B · inner | `FocusHeader` | Home |
| `/players` | B · inner | `FocusHeader` | Discover |
| `/players/[id]` | B · inner | `FocusHeader` | Players |
| `/players/compare` | B · inner | `FocusHeader` | Players |
| `/predictions/mine` | B · inner | `FocusHeader` | Predictions |
| `/profile/avatar` | B · inner | `FocusHeader` | Profile |
| `/profile/background` | B · inner | `FocusHeader` | Profile |
| `/profile/club` | B · inner | `FocusHeader` | Profile |
| `/profile/edit` | B · inner | `FocusHeader` | Profile |
| `/profile/edit/bio` | B · inner | `FocusHeader` | Edit profile |
| `/profile/edit/country` | B · inner | `FocusHeader` | Edit profile |
| `/profile/edit/name` | B · inner | `FocusHeader` | Edit profile |
| `/profile/edit/username` | B · inner | `FocusHeader` | Edit profile |
| `/profile/following` | B · inner | `FocusHeader` | Profile |
| `/profile/season` | B · inner | `FocusHeader` | Profile |
| `/rewards` | B · inner | `FocusHeader` | Profile |
| `/saved` | B · inner | `FocusHeader` | Profile |
| `/search` | B · inner | `FocusHeader` | Home |
| `/settings` | B · inner | `FocusHeader` | Home |
| `/settings/account` | B · inner | `FocusHeader` | Settings |
| `/settings/appearance` | B · inner | `FocusHeader` | Settings |
| `/settings/avatar` | B · inner | `FocusHeader` | Settings |
| `/settings/clubs` | B · inner | `FocusHeader` | Settings |
| `/settings/data` | B · inner | `FocusHeader` | Settings |
| `/settings/delete-account` | B · inner | `FocusHeader` | Settings |
| `/settings/help` | B · inner | `FocusHeader` | Settings |
| `/settings/notifications` | B · inner | `FocusHeader` | Settings |
| `/settings/privacy` | B · inner | `FocusHeader` | Settings |
| `/social/compose` | B · inner | `FocusHeader` | Social |
| `/teams` | B · inner | `FocusHeader` | Discover |
| `/teams/[id]` | B · inner | `FocusHeader` | Teams |
| `/teams/compare` | B · inner | `FocusHeader` | Teams |
| `/transfers` | B · inner | `FocusHeader` | Discover |
| `/transfers/[id]` | B · inner | `FocusHeader` | Transfers |
| `/transparency` | B · inner | `FocusHeader` | Discover |
| `/u/[username]` | B · inner | `FocusHeader` | Social |
| `/venues` | B · inner | `FocusHeader` | Home |
| `/venues/[id]` | B · inner | `FocusHeader` | Venues |

Five of these already carried a hand-rolled back link of their own — four
different sizes, three different placements, one of them at the *bottom* of a
long fixture page where nobody scrolls to find a way out. Those are gone
(`/leagues/[id]`, `/matches/[id]`, `/predictions/mine`, `/saved`,
`/profile/following`, `/fantasy/browse`); the one shared control replaces all
of them.

### `/admin` — the operations section

Admin has its own navigation: a sidebar at `lg`+, and below that a hamburger
drawer. On a phone that meant every page under here was a screen you tapped into
with nothing visible on it pointing back out. One `RouteBackLink` in
`src/app/admin/layout.tsx` covers all six.

| Route | Category | Decision | Back lands on |
| --- | --- | --- | --- |
| `/admin` | B · inner | `RouteBackLink` in the admin layout | Home |
| `/admin/football/provider` | B · inner | `RouteBackLink` in the admin layout | Admin |
| `/admin/design` | B · inner | `RouteBackLink` in the admin layout | Admin |
| `/admin/moderation` | B · inner | `RouteBackLink` in the admin layout | Admin |
| `/admin/support` | B · inner | `RouteBackLink` in the admin layout | Admin |
| `/admin/users` | B · inner | `RouteBackLink` in the admin layout | Admin |

### Public surface — outside the auth gate

`/home` is behind the gate, so the fallback for every one of these is the
landing page. Sending a signed-out reader of the Terms "back" to a redirect
to sign-in would not be a back control.

| Route | Category | Decision | Back lands on |
| --- | --- | --- | --- |
| `/` | A · root | No back control — this is the landing page | — |
| `/about` | B · inner | `RouteBackLink` in `MarketingPageShell` | KIVO |
| `/privacy` | B · inner | `RouteBackLink` in `MarketingPageShell` | KIVO |
| `/terms` | B · inner | `RouteBackLink` in `MarketingPageShell` | KIVO |
| `/support` | B · inner | `RouteBackLink` in `MarketingPageShell` | KIVO |
| `/sign-in` | B · inner | `BackLink` pinned top-left | KIVO |
| `/sign-up` | B · inner | `BackLink` pinned top-left | KIVO |
| `/onboarding` | C · flow | No route-level back — see below | — |

### Category C — left alone, on purpose

| Surface | Why no back control |
| --- | --- |
| `/onboarding` | A gated flow, not a place. There is no way *out* backwards — the account is not usable until it finishes — and "Skip for now" is the honest exit. Its own step-back button moves between steps of one flow, and was brought up to the same standard as the platform control: a 44px target and an accessible name that says where it goes ("Back to the previous step"). |
| `error.tsx` (root, `(app)`, `/admin`) | Already ends in a "Back to Home" / "Back to Overview" call to action, which is the recovery step, not navigation. |
| `not-found.tsx` (root, `(app)`) | Same — the page *is* the dead end, and its CTA is the way out. |
| Nav drawer, bottom sheets, command palette | Overlays with a close button, a backdrop click and Escape, all through `useFocusTrap`. A back control inside one would compete with three existing dismiss paths. |
| `zz-*` scratch routes | Untracked local preview routes that agents create to render a component in isolation and then delete. Never part of the product, never shipped, and deliberately absent from the tables above — if one is in your working tree it is somebody's harness, not a screen. |

---

## Adding a route

1. Decide the category. If a user gets there by tapping something, it is B.
2. Under `(app)`, there is nothing to do: anything that is not one of the six
   roots is an inner page, and `FocusHeader` renders the control automatically.
3. Outside `(app)`, drop a `<RouteBackLink />` into the surface's shell.
4. If the mechanical parent is wrong — the route's real parent is not its URL
   prefix — add it to `EXPLICIT_BACK_PARENTS` in `src/lib/route-class.ts` and a
   case to `src/lib/route-class.test.ts`. Do not hardcode a label in a page.
