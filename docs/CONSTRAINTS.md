# KIVO — Constraints

Things that are **not bugs and not backlog**. Each one was established by reading a
real response shape, a real migration, or a real vendor limit — and each one has
already been re-derived at least once by somebody who did not know it had been
settled. That rediscovery is the cost this file exists to stop.

A constraint earns a place here only if it is **immovable within KIVO's current
plan and provider**. Anything that is merely unbuilt belongs in
`RECOMMENDATIONS.md`; anything that is a deliberate product position belongs in
`DECISIONS.md`. The distinction matters, because "we chose not to" invites a
conversation and "the data does not exist" does not.

The last section is the important one: **two entries that used to be recorded as
constraints and were wrong.** A file like this is dangerous precisely because it
is believed, so it carries its own corrections rather than quietly dropping them.

---

## Data the provider does not publish

### 1. No pitch coordinates, on any tier

**API-Football publishes no spatial data at all.** `/fixtures/events` returns
time, team, player, assist, type and detail — nothing spatial. `/fixtures/players`
returns counts (shots, passes, tackles, duels, minutes); it says what a player
did and never where, and there is not even a `touches` field. The one genuinely
positional field anywhere in the API is `/fixtures/lineups`' `grid`, which is a
formation slot, not a position.

**Consequence, already built accordingly**: the heatmap engine is a
formation-slot renderer, not a tracking renderer, and it says so on the surface.
`NormalizedPitchAction.coordinate` is nullable and stays null rather than being
estimated. Full derivation in `docs/HEATMAP_ENGINE.md`.

**Do not** propose pass maps, touch maps, progressive-carry visuals, or "average
position" from this provider. There is no tier to upgrade to.

### 2. Left and right on the formation grid are unverifiable

`grid` gives a row and a column. **Whether column 1 is the team's left or its
right is not stated anywhere in the response**, and cannot be inferred, because
the same fixture can be reported from either side's frame.

**Consequence**: the pitch renders the grid honestly and labels left/right as
unconfirmed rather than committing. A mirrored heatmap looks completely
authoritative and is a coin flip — which is worse than an admitted gap.
`docs/HEATMAP_ENGINE.md` lines 126–130.

### 3. Squad profiles are shallow, and deepening them costs the whole quota

`getSquad` returns id, name, age, number, position and photo. **No date of birth
and no nationality.** Those live behind a per-player-per-season endpoint that
would burn the entire daily quota across two or three teams.

`dateOfBirth` and `nationality` are left null rather than estimated from `age`.
There is also **no player market value field on any endpoint**, and **no referee
data**. Verified against the response shape, not assumed —
`docs/API_FOOTBALL.md`, "Known free-tier gaps".

---

## Platform and infrastructure limits

### 4. Vercel Hobby crons run at most once a day

The entry that previously blocked every deployment was `* * * * *`. `0 5 * * *`
is what the plan permits, and it is what `vercel.json` carries.

**Consequence**: minute-resolution live scores do not come from Vercel. They come
from the Supabase-side `pg_cron` + `pg_net` worker (migration
`0067_scheduled_live_sync_trigger.sql`), which is deployed and deliberately inert
until two Vault secrets and `FOOTBALL_LIVE_POLLING_ENABLED` exist. See
`ENVIRONMENT.md`.

### 5. `pg_net` cannot be moved out of `public`, and `get_advisors` will keep saying so

`alter extension pg_net set schema extensions` **fails outright** — pg_net does
not support `SET SCHEMA`. Moving it means dropping and recreating the extension,
which destroys the request queue and response history of anything in flight.

**This is a permanent WARN in `get_advisors` with a stated reason.** pg_net's own
functions live in the `net` schema and are not exposed through PostgREST, so the
practical exposure is the extension's presence in `public`, not a callable
surface. Reasoning recorded at `supabase/migrations/0074_restore_upsert_fixture_grants.sql`
lines 35–45.

**Do not "fix" it.** A future session that drops and recreates pg_net to clear an
advisory will silently break the live worker.

### 6. `rate_limit_events` has RLS on and no policies, on purpose

`get_advisors` reports this as `rls_enabled_no_policy` at INFO level, forever.
The table is service-role only by design — a client that could read it could
enumerate other users' write activity, and a client that could write it could
forge its own allowance. All access goes through the SECURITY DEFINER
`check_rate_limit` RPC (migration `0066`, whose own comment states this).

**A policy added here to clear the advisory would be a security regression.**

### 7. No push notifications

There is no service worker, no APNs/FCM registration, and no infrastructure to
add one to. Every notification producer in KIVO writes an in-app `notifications`
row and nothing else.

**Consequence**: quiet hours can defer and suppress an in-app row, and cannot do
the thing quiet hours mostly exist for — stopping a phone lighting up. The
notification work says so rather than implying more.

---

## Identity and rewards

### 8. The daily XP allowance is per profile, and cannot be per person

`docs/REWARDS.md`: "The daily allowance is per profile. A person with several
accounts gets several allowances."

This is not an oversight in the rate limiter — it is a direct consequence of the
auth model. **The only thing KIVO verifies about a person is that they can read
one email address**, and email addresses are free and unlimited. Nothing in the
sign-up flow ties two profiles to one human, and the multi-account switcher makes
holding several accounts on one phone an explicitly supported feature.

> **Corrected 2026-08-19.** This paragraph used to give the reason as "KIVO signs
> people in with an emailed one-time code and stores no password", and KIVO now
> has passwords (`DECISIONS.md`, "KIVO has passwords again"). The conclusion is
> unchanged — but the old reason was wrong even before passwords arrived, and it
> is worth saying why rather than just swapping the sentence.
>
> **A password is not an identity.** It proves the person knows a secret, not
> that they are one particular human. One person can hold ten passwords for ten
> addresses as easily as they can hold ten mailboxes. So adding passwords moved
> nothing at all here: the binding was never missing *because* there was no
> credential, it was missing because the credential is chosen by the user and
> attaches to an address they can create again in thirty seconds.
>
> The 2026-08-19 sign-up form also now collects a **country**. That is
> self-declared and unverified, and it is not a binding either. Nothing about it
> may be used to argue this constraint has weakened.
>
> What *would* actually bind a profile to a human is a factor the user cannot
> mint on demand: a phone number verified by SMS, a government ID check, or a
> payment instrument. KIVO has none of these, and adding one is a product
> decision with real cost — in the launch market a phone-number wall would
> exclude real users to stop a problem that, per the containment below, does not
> cost anything today.

**Do not** propose device fingerprinting or IP-based linking as the fix; both
were considered and both are worse than the problem — they punish shared
connections, which in the launch market is the common case, not the edge case.

The real containment is that XP buys nothing. It is a score, not a currency.
Changing that is a product decision with this constraint attached to it.

---

## Corrections: two things recorded here that turned out to be wrong

Kept, not deleted. Both were stated with confidence, both were reasoned from an
assumption rather than a response, and both cost a later session real time.

### C1. "Trending is not buildable" — **wrong, and the reasoning was wrong too**

`KIVO_NEXT_GEN.md` KN-142 recorded trending as NOT BUILDABLE on the grounds that
KIVO has no view-tracking table and no analytics event log. Both facts are true.
The conclusion does not follow.

**Trending shipped on 2026-08-19** (`src/app/(app)/social/trending.ts`, migration
`0089_trending_and_fan_sentiment.sql`) because it counts a different thing:
**participation, not attention.** Real `posts` and `comments` rows inside a real
time window are a first-class fact KIVO already owns; views are not. The
implementation names its window, refuses to rank a window with too little in it,
and separates "nothing happened" from "KIVO could not read".

The lesson is narrower than "KN-142 was wrong": *an absent measurement does not
make the question unanswerable — check whether a different real signal answers a
slightly different, more honest question.*

### C2. "Per-match individual player statistics are free-tier-unavailable" — **unverified, and now answerable**

This was recorded in `docs/API_FOOTBALL.md` from `BUILD_STATUS.md`'s reading of
the free tier and **was never checked against a live response** — no build
environment on this project has had a route to api-football.com.

It is now neither asserted nor denied. Per-match player statistics and injuries
are **implemented**, and both ask the coverage registry
(`src/lib/football/coverage-registry.ts`, migration `0082`) before spending a
request. The registry stores API-Football's own per-competition `coverage`
object — the provider's own statement about exactly this question — so it
resolves itself the first time it runs against a live key.

**If you are about to repeat "the free tier does not have it": you do not know
that, and neither did the person who wrote it down.**

---

## How to add to this file

An entry needs: what is not possible, **the artefact that establishes it** (a
response shape, a migration line, a vendor limit — not a recollection), what KIVO
does instead, and what not to propose. If you cannot cite the artefact, it is a
recommendation, not a constraint.
