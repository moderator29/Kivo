# Performance

KIVO's stated launch market is Nigeria, on mobile networks. That makes
performance a correctness requirement rather than a polish task: a screen that
takes fourteen seconds to arrive has not rendered, it has failed. This document
is the measured baseline, what the numbers accused, what was changed, and the
numbers again afterwards.

Every number here was measured. Nothing in this file is an estimate.

---

## Conditions

A number without its conditions is not a measurement.

| | |
| --- | --- |
| Build | `next build` + `next start` (production, Next 16.3.1, Turbopack). Never the dev server. |
| Browser | Chromium 1194 via Playwright, launched with the proxy environment cleared |
| Device | 390×844, DPR 3, `isMobile`, Android UA — a mid-range Android phone |
| Network | CDP `Network.emulateNetworkConditions`: **400 kbit/s down, 400 kbit/s up, 400 ms RTT** (Chrome DevTools "Slow 3G") |
| CPU | CDP `Emulation.setCPUThrottlingRate: 4` |
| Cache | `Network.setCacheDisabled: true` — every run is a first visit |
| Vitals | LCP / CLS / long tasks via `PerformanceObserver` with `buffered: true`, 7 s settle, median of 2 runs |
| Weight | Measured **separately and unthrottled**, `waitUntil: "load"` + 2.5 s |
| Isolation | Two git worktrees, one at HEAD and one at HEAD + this pass, each with its own build and its own server on its own port |

Two of those need saying out loud.

**Weight is measured unthrottled on purpose.** At 400 kbit/s the browser
transfers about 50 KB/s, so any fixed observation window measures the pipe, not
the page: the first baseline run reported ~130 KB for every route because that
is simply what fits in six seconds. Total bytes and time-to-render are separate
questions and have to be measured separately.

**Each build gets its own worktree.** Six agents are working in this repository
tonight. A measurement taken against a tree that somebody else is editing is not
a measurement of anything.

**What could not be measured, and why.** Everything under `(app)` is behind the
auth gate, KIVO signs in by emailed one-time code, and the Supabase instance is
unreachable from this environment (`/api/health` reports
`database: unreachable`). So `/home`, a fixture page, the social feed and
fantasy have no LCP/CLS numbers here. They are covered two other ways that are
still real: exact per-route JavaScript weight read out of the build manifests,
and a component benchmark that renders a real list component at the real row
count under CPU throttling. Where a number is synthetic, it says so.

---

## Baseline, and after

### Page weight (unthrottled, cold, bytes over the wire)

| Route | Before | After | Change | Images before → after |
| --- | --- | --- | --- | --- |
| `/` | 1498 KB | **804 KB** | −694 KB (−46%) | 1139 → 454 KB |
| `/about` | 1070 KB | **375 KB** | −695 KB (−65%) | 700 → 15 KB |
| `/terms` | 1061 KB | **342 KB** | −719 KB (−68%) | 689 → 4 KB |
| `/privacy` | 1062 KB | **364 KB** | −698 KB (−66%) | 689 → 4 KB |
| `/support` | 1066 KB | **347 KB** | −719 KB (−67%) | 689 → 4 KB |
| `/sign-in` | 1122 KB | **396 KB** | −726 KB (−65%) | 742 → 53 KB |
| `/sign-up` | 1152 KB | **414 KB** | −738 KB (−64%) | 742 → 53 KB |

At 50 KB/s that is about **fourteen seconds** removed from every entry point
into the product.

### Core Web Vitals (Slow 3G + 4× CPU, median of 2)

| Route | FCP before → after | LCP before → after | CLS before → after |
| --- | --- | --- | --- |
| `/` | 3520 → **3248 ms** | *no candidate* → **3568 ms** | 0.0149 → **0.0055** |
| `/about` | 3352 → **3160 ms** | 3352 → **3160 ms** | 0.0032 → 0.0032 |
| `/terms` | 3336 → **3152 ms** | 3336 → **3152 ms** | 0.0332 → 0.0332 |
| `/privacy` | 3304 → **3136 ms** | 3304 → **3136 ms** | 0.0039 → 0.0039 |
| `/support` | 3372 → 3164 ms | 4204 → **3164 ms** | 0.0184 / 0.209 (see below) |
| `/sign-in` | 3320 → 3332 ms | 7128 → 7208 ms | 0.0008 |
| `/sign-up` | 3316 → 3312 ms | 7120 → 7120 ms | 0.1009 |

`/` had **no LCP candidate at all** in the observation window before this pass.
That is not a good score, it is a missing one: the largest element is the hero
mark, and the raw 689 KB asset saturating a 50 KB/s pipe meant no image finished
in time to become a candidate. After, the page reports a real LCP.

**Total Blocking Time is deliberately not tabled as a before/after.** It ranged
254–781 ms across runs on the same build in this sandbox, which is wider than
any change measured here. Claiming a TBT improvement from it would be an
assertion, not a measurement. It is used below only where the difference is
five-fold or more.

### JavaScript per route (gzipped, from the build manifests)

Exact, and available for every route including the ones behind the gate.

| | gzipped |
| --- | --- |
| Shell — every route in the product pays this | **166.8 KB** |
| Common to all 55 `(app)` routes, on top of the shell | **126.7 KB** over 13 chunks |
| **Floor for any signed-in page, before its own code** | **≈ 293 KB** |
| `/matches/[id]` | 396.6 KB |
| `/social` | 372.6 KB |
| `/live` | 363.3 KB |
| a typical settings or profile page | ≈ 295 KB |

`/profile/edit/name` is one text field and ships 295 KB of JavaScript. At
50 KB/s that is six seconds before the field is interactive.

Two chunks account for most of it:

- **43.0 KB — `motion` (framer-motion), on 70 of 71 routes.** Reaching every
  route including `/terms`, which has no animation at all.
- **64.8 KB — Supabase Realtime, on `/matches/[id]`, `/social` and `/live`.**
  Legitimately needed by those three; it is the reason they are the heaviest
  routes in the product.

---

## What the numbers accused, and what was done

### 1. A 689 KB image to draw a 32-pixel glyph — fixed

`KivoMarkGlyph` rendered a plain `<img src={kivoLogo.src}>`, deliberately, to
keep control of the crop geometry. A plain `<img>` bypasses the image optimizer
entirely, so every page carrying the KIVO mark downloaded the whole
`kivo-logo-transparent.webp` source — **688.9 KB over the wire** — to draw a
28–32px glyph. That is the marketing pages, the legal pages, `/support`,
`/sign-in`, `/sign-up`, onboarding, the profile cover, and **every post card in
the social feed**.

Routed through `next/image` with the geometry preserved exactly (explicit
`width`/`height` for the optimizer, the real fractional size still set in
`style`, never `fill`). The optimizer's WebP for a 32px box on a DPR-3 phone is
**3.2 KB**. `loading="eager"` rather than `priority` — it is above the fold, but
a decorative 3 KB mark should not preload ahead of the page's real content.

That single component is the whole of the weight table above.

### 2. Lists that render five hundred rows — fixed

`/managers` and `/venues` each fetch up to 500 rows and render every one,
because both filter in the browser rather than on the server. Benchmarked
against the **real `ManagersList`** at 500 rows on a 4×-throttled CPU (synthetic
rows, in a harness route that was deleted afterwards — the component is real,
the data is not, and none of it ships):

| | Before | After | |
| --- | --- | --- | --- |
| Rows in the DOM | 500 | **60** | |
| DOM nodes | 6,071 | **793** | −87% |
| First render, wall | 5,754–6,688 ms | **4,901 ms** | |
| First render, TBT | 2,807–4,005 ms | **642 ms** | −77 to −84% |
| Worst single long task | 1,009–1,172 ms | **227 ms** | −78% |
| Typing 16 characters, TBT | 3,869–4,580 ms | **793 ms** | −80% |
| Typing 16 characters, wall | 9,126–9,719 ms | **5,867 ms** | −40% |

A 1,172 ms task is a second of a phone that does not respond to anything. And
every keystroke in the filter re-rendered all 500 rows — each one a
`motion.div` with `layout`, which measures its own bounding box on every render.

The fix keeps every row in memory, so the filter still searches all 500, and
renders a window of 60 with an explicit "Show more" — the same idiom `/teams`,
`/leagues` and the feed already use. Verified in a browser at both widths:
60 rows and "Showing 60 of 500" on arrival, 120 after one press, a search for
`Manager Number 49` finding all 11 matches from across the full set (not just
the rendered 60), the window resetting on a new query, and the no-match state
intact.

**Deliberately not virtualization.** Windowing by scroll position means
measuring rows, synthesising scroll height and re-rendering during scroll — a
lot of machinery, and it produces a list that cannot be found with ctrl-F or
read linearly by a screen reader. A capped list with a truthful count keeps
every rendered row real, and says how many there are instead of implying it.

The logic is pure and under test (`src/lib/capped-list.ts`,
`src/lib/capped-list.test.ts`), including that the status line says nothing at
all when nothing is being withheld — "showing 12 of 12" makes a complete list
look truncated.


### 3. A monospace font nobody public can see, preloaded on every route — fixed

Geist Mono is used on exactly four surfaces: the error-reference code, the
sign-in code input, and two invite-code fields in the prediction leagues panel.
None is public. `next/font` preloaded it on **every** route anyway — a second
render-blocking request ahead of the typeface the page is actually set in.

The change is `preload: false`, `display: "optional"` and a real `fallback`
list on the `Geist_Mono(...)` call in `src/app/layout.tsx`. Plus Jakarta Sans is
untouched.

**The mechanism, measured directly.** Font requests per public route:

| Route | Before | After |
| --- | --- | --- |
| `/terms` | 2 requests, 49.2 KB | **1 request, 26.6 KB** |
| `/support` | 2 requests, 49.2 KB | **1 request, 26.6 KB** |
| `/sign-up` | 2 requests, 49.2 KB | **1 request, 26.6 KB** |
| `/` | 2 requests, 49.2 KB | 2 requests, 49.2 KB — but the second is no longer preloaded, so it lands after first paint and `display: optional` declines the swap |

**Core Web Vitals, same conditions as the table above, median of 3, confirmed
across two independent passes:**

| Route | FCP before → after | LCP before → after | CLS before → after |
| --- | --- | --- | --- |
| `/` | 3212 → **3196 ms** | *no candidate* → **3916 ms** | 0.0199 → **0.0006** |
| `/about` | 3124 → **3076 ms** | 3132 → **3076 ms** | 0.0033 → **0.0005** |
| `/terms` | 3140 → **3012 ms** | 3140 → **3012 ms** | 0.0166 → **0.0126** |
| `/privacy` | 3116 → **2996 ms** | 3116 → **3032 ms** | 0.0167 → **0.0110** |
| `/support` | 3120 → **2952 ms** | 3120 → **2952 ms** | 0.0231 → **0.0155** |
| `/sign-in` | 3248 → **3216 ms** | 6884 → **6612 ms** | 0.0014 → **0.0000** |
| `/sign-up` | 3276 → **3200 ms** | 7060 → **6772 ms** | 0.0941 → **0.0148** |

**Two corrections to the measurement that proposed this**, both in the
direction of claiming less.

The earlier note recorded "CLS 0.0000 on all seven public routes" and "FCP
250–400 ms faster". Neither reproduces. CLS falls a long way but lands at
0.0005–0.0155, not zero, and FCP improves by **16–128 ms**, not 250–400. The
larger figure appears to have come from comparing runs that landed on opposite
sides of the race described next.

The real win is not the median, it is the **variance**. `/support` measured CLS
0.2089 on one baseline pass and 0.0231 on another — the same build, the same
conditions. That bimodality is the point: it is a race between the font arriving
and first paint happening, and before this change it was a coin toss. After, it
is 0.0155 on every pass. What was removed is the worst case, and the worst case
was a fifth of a viewport moving under the reader's thumb.

**Underneath sits something that will bite this product again.** Next's
`adjustFontFallback` emits:

```css
@font-face { font-family: "Geist Mono Fallback"; src: local("Arial");
             ascent-override: 74.67%; size-adjust: 134.59%; }
```

**Android has no Arial.** The `local()` never matches, the size-adjusted face is
dropped, and the metric matching Next advertises silently does nothing on
exactly the devices this product is being launched for. That is why the reflow
was 0.2 rather than 0.02, and it is why the explicit `fallback` list naming
families Android actually ships is load-bearing rather than decorative.

---

## Measured, not landed — these need an owner

### The landing hero is 454 KB of one image

`src/app/page.tsx` is owned by another agent. `KivoMark` blows
`kivo-logo-transparent.webp` (a 1254² source, 689 KB on disk) to 196% width with
`sizes="(min-width: 1024px) 640px, (min-width: 640px) 500px, 420px"`. On a DPR-3
phone that resolves to `w=1920`, and the optimizer's WebP at that width is
449 KB. The full ladder, measured against the running build:

| w | 64 | 128 | 256 | 384 | 640 | 828 | 1080 | 1200 | 1920 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| KB | 3.2 | 9.2 | 27.0 | 52.7 | 125.9 | 197.4 | 310.0 | 369.5 | 449.3 |

`w=1920` also **upscales** a 1254px source, so it buys file size and no detail.

Quality is not the lever: with `images.qualities` enabled, `q=50` at `w=1920` is
412 KB against 449 KB at `q=75` — 8%. The cost is structural. The entire 1254²
square carries a ~4%-alpha glow (this is documented in
`src/components/theme/ink-filter.tsx`, which exists to strip it), and a
full-frame alpha gradient is expensive in WebP at any quality. The fix is a
re-exported source, which is a brand-asset decision and not one to take
unilaterally.

### The favicon is 25.9 KB, on every page

`src/app/favicon.ico`. It appears as ~26 KB of "other" in every row of the
weight table. Almost certainly a large embedded size that no browser tab uses.

---

## Checked and found not to be a problem

Worth recording so nobody spends the day re-deriving it.

- **Most long lists are already bounded.** `/teams` and `/leagues` page at 60
  through the URL, the feed at 20 with an explicit "Load more",
  `/notifications` at 30, profile posts at 10. `/managers` and `/venues` were
  the two that fetched 500 and rendered all of them; both are fixed above.
- **Images have dimensions.** The lazy-loaded images on the landing page all
  carry `width`/`height` attributes, so they reserve their space and none of
  them shows up as a layout-shift source. Every shift measured on every route
  traced back to font swap, not to images.
- **Charts already refuse to draw what they do not know.** `SeriesChart`
  returns `null` below two points and centres a flat series rather than
  dividing by a zero span. Lazy-loading it would trade a real 9 KB for a
  skeleton and a second network round trip.
- **The bundle budget script already exists** (`scripts/check-bundle.mjs`) and
  is worth keeping honest: at the time of this pass the `client` budget was
  **over** at 662.8 KB against 640 KB. Its own header already predicted the
  cause — "`motion` is in the shell only because components in the app shell
  itself import it… Tracked, not done here."
- **Moving `MotionConfig` out of the root layout buys ~0.2 KB, not 47 KB — do
  not spend the accessibility risk on it.** An earlier note measured
  "JavaScript per public route 229–243 KB → 179–187 KB, about −47 KB on every
  route" and proposed relocating `<MotionConfig reducedMotion="user">` down to
  the surfaces that animate. Built and measured both ways, in two isolated
  worktrees off the same commit:

  | | Before | After |
  | --- | --- | --- |
  | Shell (`rootMainFiles` + polyfills, gzipped) | 166.8 KB | **166.8 KB** |
  | All client chunks, gzipped | 647.3 KB | **647.1 KB** |
  | `/terms` total route JS | 253.7 KB | **253.5 KB** |
  | `/terms` motion-containing bytes | 53.1 KB | **50.6 KB** |
  | `/` total route JS | 251.1 KB | **250.8 KB** |

  The shell does not move **at all**, because `motion` was never in it — the
  43 KB chunk is not among `rootMainFiles`. And every public route still ships
  50–67 KB of motion after the removal, because 62 files across `src/components`
  import `motion/react` directly and the route pulls them for its own sake.
  `MotionConfig` was one import among many, not the reason the runtime shipped.

  The measurement that produced −47 KB most likely read the shrinking of one
  named chunk without noticing that Turbopack re-split the same modules into
  differently-named ones: by filename, the 43 KB chunk disappears from all 70
  routes; by content, the bytes are still there.

  So the trade is 0.2 KB per route against remounting `MotionConfig` on nine
  separate surfaces — `(app)`, admin, `/`, `/about`, `/sign-in`, `/sign-up`,
  `/support`, `/onboarding`, `not-found` — where forgetting one silently
  removes `prefers-reduced-motion` for everything under it. `reducedMotion`
  defaults to `"never"`, so a missed mount is not a degraded animation, it is an
  accessibility regression that nothing fails on. Not worth it.

  The route that would genuinely benefit is `/terms` and `/privacy`, and the way
  to get it is the one `check-bundle.mjs`'s own header already names: move the
  app shell's own animations to CSS, the way `FadeIn` was. That removes the
  bytes rather than moving the provider that references them.

---

## Re-measuring

```sh
npx next build && npx next start -p 3141
env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy NO_PROXY='*' \
  node scripts/local-perf/measure.mjs      # vitals, throttled
env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy NO_PROXY='*' \
  node scripts/local-perf/weigh.mjs        # weight, unthrottled
```

Two harness details that cost hours and are not obvious:

- Browse `http://localhost:<port>`, **not** `http://127.0.0.1:<port>`. The
  origins differ, Next's dev server answers 403 for every `_next/static` chunk
  across them, and the page renders as though every animated element were
  invisible.
- Use `waitUntil: "domcontentloaded"` plus an explicit `waitForSelector`.
  `networkidle` never fires against a dev server, because of the HMR socket.
