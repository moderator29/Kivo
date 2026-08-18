# KIVO structural survey

Written 2026-08-17/18 as the final synthesis pass after a night of parallel work: a landing-page
expansion, an onboarding redesign, and eight feature-area audit+fix passes (Fantasy, Predictions,
Notifications & Search, browse surfaces, Admin, Rewards, Match Centre, Social). This is a top-down
read of the whole platform's real state — not a recap of tonight's diffs (see the commit log and
`RECOMMENDATIONS.md` item 240 for that), but an attempt to answer "if a human opened this codebase
cold right now, what would they actually find." Every claim below was checked against the real
code tonight (grep, direct file reads, `tsc`/`eslint`/`build`/`test`), not inferred from doc
comments or agent summaries alone. Where a claim rests on a spot-check rather than an exhaustive
read, it says so.

---

## What's genuinely solid

**The zero-fabrication discipline holds under real pressure, not just in the easy cases.** This is
the platform's one non-negotiable rule, and it's been tested by more than a hundred small
decisions across tonight's passes alone: transfer rumour confidence tiers were formally retired
rather than left as a tempting backlog item (item 178); market value was never speculatively
scoped, just documented as out of scope (item 179); the rating engine shipped fully built and
tested but was deliberately never wired to a UI because the live project has zero finished
fixtures to calibrate against (item 225) — an agent had a working feature ready to ship and chose
not to ship it rather than present an uncalibrated number as reliable. Empty states throughout the
app say "not synced yet," never a plausible-looking placeholder. This is a hard discipline to
sustain across dozens of independent passes and it has held.

**The football data layer is a real abstraction, not a thin wrapper around one vendor.**
`FootballDataProvider` (`src/lib/football/types.ts`) is implemented by two working providers
(API-Football, TheSportsDB) plus a dev-only mock, with normalized domain types the rest of the app
never has to know are provider-shaped. Where a provider genuinely can't supply something (TheSportsDB
has no lineups/events/statistics on its free tier), the adapter throws a clear "not supported by
this provider" error instead of guessing at a response shape — confirmed directly in
`providers/thesportsdb.ts`. Sportmonks was fully and cleanly removed (code, env vars, DB columns)
when the founder changed direction, with a documented decision trail in `DECISIONS.md` rather than
dead code left behind. Rate limiting for the free-tier quota is real (`x-ratelimit-requests-remaining`
parsed and surfaced on Data Health, item 53), not estimated.

**Auth and data-access boundaries are consistently RLS-first.** 89 `create policy` statements
across 43 migrations, a single identity authority resolved through one `SECURITY DEFINER`
indirection helper (`private.current_profile_id()`) rather than by policies reading an identity
column directly — which is what made the 2026-08-18 Clerk→Supabase-Auth swap a six-policy change
instead of a fifty-policy one — and, notably, guest-visible surfaces are handled correctly via narrow `SECURITY DEFINER` RPCs
(`get_public_profiles`, `get_public_profile_by_username`, `get_most_followed_teams`,
`get_prediction_leaderboard`) rather than by loosening the base `profiles_select_own_or_admin`
policy. That's the harder, more correct way to solve "guests need to see usernames," and it's the
pattern used consistently rather than reached for once and abandoned.

**The product surfaces that looked unreachable six weeks ago are now real, working features, and
tonight's audits mostly found small bugs in them, not missing floors.** Fantasy squad building,
gameweek scoring, and leaderboards; predictions with real scoring and a real leaderboard RPC;
Match Rooms on real fixture-scoped posts; comment threads with reactions; an AI Copilot that's
grounded in real synced data, tags its own claims as verified-vs-calculated, and shows the user its
literal context window on request (items 184/185/188/189, all confirmed shipped). The fact that
eight separate feature audits, each re-reading the current code from scratch, mostly found
polish-level issues (tap targets, missing `aria-pressed`, a captain-conflict edge case) rather than
"this doesn't actually work" is itself a signal about baseline quality — and this session's own
verification (`tsc`/`eslint`/`build`/`test`, all clean, run repeatedly under eight-way concurrent
editing on a shared tree with no force-pushes or lost work) confirms the discipline extends to
process, not just code.

**Operational floor-level UX is now broadly in place**, not scattered: every route group has
`loading.tsx`, `error.tsx` exists at both the `(app)` root and `/admin`, `not-found.tsx` exists,
CI runs `tsc`/`eslint`/`build` on every commit (`.github/workflows/ci.yml`), and `@vercel/analytics`
is wired into the root layout. None of this was true as recently as the 2026-08-14 baseline that
`RECOMMENDATIONS.md`'s opening section still describes (see the "genuinely thin" note on that
document below).

---

## What's genuinely thin

**The sync pipeline is still fundamentally a person clicking a button, and that's a real
scalability ceiling, not just an MVP simplification.** Every fixture, squad, standings, and
statistics sync is admin-triggered from Data Health. `FOOTBALL_LIVE_POLLING_ENABLED` exists and is
correctly off, with no automated worker anywhere in the codebase (confirmed: no cron config, no
scheduled function). Realtime distribution to viewers is real and tonight's Match Centre pass fixed
a genuine crash in that exact path (`MatchScoreDisplay` re-render loop) — but the trigger that
originates fresh data is still entirely manual. This is a deliberate, documented, budget-driven
choice, not an oversight, but it means "real-time" currently means "real-time once someone syncs,"
and that gap will become visible the moment real users expect live scores during a live match.

**Test coverage is real but shallow relative to the codebase's actual surface area.** 13 test files
against roughly 288 non-test TypeScript/TSX files under `src/`. The tests that exist are
well-chosen — `validateRoster`, the provider normalizers, the rating/form/heatmap engines, one RLS
integration test — but there is exactly one RLS integration test file
(`rls-anon.integration.test.ts`) protecting 89 policies across every table in the schema, and zero
tests on the ~31 files containing server actions, which is where most of the app's actual mutation
logic and authorization decisions live. A regression in a server action's auth check would not be
caught by anything currently running in CI.

**Error visibility is a half-step, honestly labelled as one.** `src/lib/log.ts` is a well-reasoned,
explicitly-not-pretending-to-be-Sentry structured logger — its own doc comment says so — but only
5 call sites use it against 112 raw `console.error` calls elsewhere in `src/`. In a serverless
deployment, effectively all of those 112 are write-only. This is a known, documented gap (item
204/211), not a surprise, but it means a real production incident tonight would currently be
diagnosed by reading Vercel's raw stdout, not by any structured search.

**Admin capability is read/observe/moderate-lightly, not administer.** The Users table is now
honestly labelled read-only rather than silently missing actions (tonight's fix), but there is
still no ban, suspend, or role-change path anywhere — confirmed directly, no `banned` column, no
matching RLS policy in any of the 43 migrations. For a platform about to carry user-generated
content (posts, comments, reports), the moderation queue can act on individual pieces of content
but has no lever over a repeat-offending account at all.

**`RECOMMENDATIONS.md` itself is a trust problem right now.** Its own opening section, "Blocking
gaps," is dated 2026-08-14 and reads as a live list of things that don't work. A direct spot-check
tonight found the large majority of those 20 items already shipped — fantasy gameweeks, predictions
scoring, the leaderboard RPC, Match Rooms, fixture statistics, all six reaction types, guest author
names, the "Your teams" module — several evidently landed in a session after that baseline. A human
opening this file to decide what to build next would be actively misled about how much of the
"blocking" list is still blocking. (See item 240, added tonight, for the specifics and what's
still confirmed genuinely open.) This is the single easiest-to-fix, highest-trust-cost item in the
whole survey.

**Rate limiting has a real, well-built mechanism (a Postgres sliding window,
`src/lib/rate-limit.ts`, fails open on infra errors and closed on the actual limit — a sound
design) but inconsistent coverage.** It's wired into `createPost`, `toggleLike`, `toggleFollow`,
`submitPrediction`, `searchPlatform`, and several others — but not `createComment`/`createReply`,
which is now a guest-adjacent, unauthenticated-reachable-adjacent surface with zero request cost
control (item 239, tonight).

---

## The 5 highest-leverage things a human should look at next

1. **Re-audit `RECOMMENDATIONS.md`'s "Blocking gaps" section (items 1–20) against current code and
   mark what's actually done.** This costs an afternoon and fixes nothing in the product, but every
   other prioritization decision downstream of this document is currently working from a
   substantially wrong picture of what's built. Tonight's spot-check (item 240) is a running start,
   not a finish.

2. **Decide, deliberately, what "admin" needs to be able to do to a user account before real users
   arrive.** Not build it reflexively — decide it. Posts, comments, and reports are all real and
   live; the moderation queue can act on content but has zero lever over a repeat-offending account.
   This is a product/policy decision (what does "banned" even mean here — hard delete, soft lock,
   shadow-mute?) as much as a schema one, and it's the kind of thing that's cheap to design now and
   expensive to retrofit once real accounts and real reports exist.

3. **Put a real automated sync trigger behind a feature flag, even if it stays off.** The entire
   realtime-distribution investment (migration 0038, `use-realtime-fixtures.ts`, tonight's crash fix
   in `MatchScoreDisplay`) is only as valuable as what triggers fresh writes, and right now that's
   exclusively a human clicking "Sync now." Building the scheduled trigger — quota-aware, with the
   dedup/health-monitoring the codebase's own docs already flag as prerequisites — is the single
   biggest lever between "impressive tech demo" and "a live scores product," and it's explicitly
   gated behind real infrastructure decisions (item 62, `FOOTBALL_LIVE_POLLING_ENABLED`) that
   nobody has had to make yet because nothing has forced the question.

4. **Spend a day on server-action test coverage, specifically authorization paths, not more UI
   polish.** 31 files carry `"use server"` mutation logic and one integration test file covers RLS.
   The engines (rating/form/heatmap) and pure functions are well tested; the code that actually
   decides who can write what is not. This is the kind of gap that stays invisible right up until
   it isn't.

5. **Turn the existing `logError` wrapper into an actual sink once real credentials exist, and
   convert the 112 raw `console.error` call sites while doing it.** The design is already right
   (`src/lib/log.ts`'s doc comment lays out exactly why it's a thin wrapper today and what changes
   when a Sentry/APM account exists) — this is purely a "do the mechanical conversion" task once
   someone has five minutes to set up the account, not a design problem waiting to be solved.

---

*Everything above reflects a spot-check, not an exhaustive re-audit of every file in the
repository. Where this document says "confirmed directly," a grep or a file read backs it up in
this session; where it characterizes a broader pattern ("the discipline extends throughout"), that
characterization is inferred from a representative sample, not a full line-by-line pass.*
