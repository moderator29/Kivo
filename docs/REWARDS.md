# Rewards: XP, streaks, badges and leaderboards

Written from the code, not from the brief. Every claim below names the file or
migration that makes it true, so this document can be checked rather than
trusted. Where something is not built, it says so.

The founding directive asks for XP, streaks, badges, leaderboards, anti-farming
controls and a rewards ledger, and forbids gambling or cash-prize mechanics
without separate legal work. **KIVO has no cash, no prizes, no purchasable
currency and no wagering.** XP cannot be bought, transferred between accounts,
or exchanged for anything. It is a score. That is a deliberate product position
recorded in `KIVO_BUILD_ACKNOWLEDGEMENT.md` and unchanged since.

---

## 1. Where XP comes from

Five producers, and only five. `grep -rn "awardXp(\|awardSocialPostXp(" src/`
is the whole list, and it is meant to stay short enough for that to be a real
audit.

| Source | Amount | Identity key | Bounded by |
|---|---|---|---|
| Correct prediction | 3–6 pts × 5 = 15–30 XP | `prediction:<id>` | The real fixture result. Not user-controllable. |
| Post | 2 | `post:<id>` | 10 XP-earning posts per rolling 24h |
| Poll | 2 | `post:<id>` | same allowance |
| MOTM Room poll | 2 | `post:<id>` | same allowance |
| Referee Room poll | 2 | `post:<id>` | same allowance |
| Completing onboarding | 10 (`ONBOARDING_COMPLETE_XP`) | `onboarding:<profile id>` | Once per profile, by construction |

Nothing else awards XP. Reactions, comments, follows, saves, votes and fan
ratings award none — deliberately, because all six are one-tap actions with no
natural ceiling.

### The rule every source has to satisfy

Stated once, in `src/lib/xp-policy.ts`. XP is either:

- **verified** — earned from an event KIVO checked against its own synced data,
  in which case it needs no cap, because the user cannot manufacture the event;
  or
- **capped and deduplicated** — earned from something the user does
  unilaterally, in which case it must carry a stable identity key *and* sit
  behind a real allowance.

There is no third category. An award that is neither verified nor capped is the
anti-farming hole.

### Two holes that existed and are now closed

Both were in the templated Match Room polls, and both came from the same cause:
the daily allowance was a pattern to copy rather than a function to call.

1. **No allowance at all.** `createMotmPoll` and `createRefereePoll` awarded the
   same +2 as a post and skipped the 10-per-day XP check that `createPost` and
   `createPoll` had enforced since item 141.
2. **A dedup key built from user input.** The referee poll keyed its award on
   `ref-poll:<fixture>:<decision>:<minute>`. Five decisions × 131 minute values
   = 655 distinct "already awarded?" keys per fixture, each worth another 2 XP,
   bounded only by the 5-posts-per-minute rate limit. A key must identify *the
   thing that happened*; the thing that happened is a post.

Both now route through `awardSocialPostXp(profileId, postId)`, which owns the
allowance and keys on the real `posts.id`.

### What still is not enforced, honestly

The daily allowance is per profile. A person with several accounts gets several
allowances. KIVO has no device or payment signal that could bind accounts
together, and inventing one from IP would be both unreliable and a privacy
decision nobody has made. Since XP buys nothing and appears on no cross-user
ranking (see §5), the payoff for doing this is a larger number on your own
profile. Logged here rather than papered over.

---

## 2. The ledger

`xp_ledger` (migration 0001, `source_key` added in 0061) is the source of
truth. There is **no** denormalised XP counter anywhere: `get_xp_total`
(migration 0023) sums the ledger, and every surface — `/rewards`, `/home`,
`/profile`, the account switcher — calls it. A total and its explanation
therefore cannot disagree, because the total *is* the explanation summed.

- One row per real award: `amount`, `reason`, `source_key`, `created_at`.
- `xp_ledger_select_own` — you can read your own rows and nobody else's.
- No client write policy at all. Only the service-role client writes, through
  `src/lib/rewards.ts`.
- `idx_xp_ledger_source_key` is unique on `(profile_id, source_key)`, so a
  retried Server Action, a re-run admin pass or a double submit credits nothing
  twice. A 23505 is treated as success, because the user really does hold the
  XP.

### It can now go down, and that is the point

Until recently every award was one-directional. A prediction scored correct
wrote +15 and no path existed that could take it back — fine while a verdict
could only be reached once, and wrong the moment three things became possible:
an unresolvable prediction settling later, an audited admin correction changing
a final score, and a fixed scoring bug being re-run.

`reconcileXp(profileId, sourcePrefix, desiredTotal, reason)` sums what a source
has already paid out, compares it to what it should now pay out, and writes the
**difference** as a new row keyed `<prefix>:adj:<n>`. Running it twice with
nothing changed writes nothing, because the delta is zero. The original row is
never edited — it records something that really did happen at a real time.

So "why did my XP drop" has an answer on `/rewards`: a dated line with a reason
on it.

`scorePredictions` now re-examines every prediction on a finished fixture
rather than only the unsettled ones, and reconciles each. It reports
`recordsProcessed`, `unresolvedCount` and `adjustedCount` as three separate
numbers, because folding them together would let a pass that resolved nothing
report forty scored.

### Why this is not shaped like the fantasy breakdown

`fantasy_point_breakdowns` is keyed `(fantasy_team_id, gameweek_id, player_id)`
and **upserted** — a rescore replaces the explanation, because fantasy points
are a recomputed function of a gameweek. `xp_ledger` is append-only with a
dedup key, because XP is a record of awards that happened at times.

Two shapes for two genuinely different things. Making the ledger replaceable
would destroy the audit trail; making the breakdown append-only would leave
stale rows that no longer correspond to any roster slot. This was checked
against `src/lib/fantasy-gameweek-scoring.ts` before writing, not assumed.

---

## 3. Streaks

There are two, they are different, and conflating them would be a bug.

### Prediction streak — a real computation

`computeStreaks` in `src/lib/predictions.ts`. Not a number on Home: it is one
pure function shared by `/predictions/mine` (display), `src/lib/home/data.ts`
(Home's summary) and `scorePredictions` (the `three_prediction_streak` badge),
specifically so the three cannot drift.

Runs are ordered by the fixture's **kickoff_at**, not by when the prediction was
submitted — a pick made a week early and one made a minute before kickoff must
rank by when the match happened.

What breaks it:

| Verdict | Effect |
|---|---|
| correct | extends the run |
| incorrect | breaks it, resets to zero |
| **unresolvable** | **neither** — the row is not in the input at all |

The third case is the one that needs saying out loud. A prediction KIVO could
not settle is not a hit and not a miss, because KIVO never found out. Breaking
an eight-match run over a fixture whose statistics feed failed would punish a
user for an outage; extending it would credit them for a result nobody checked.
The run spans straight across the gap.

Every caller passes only settled rows, and all three do it the same way:
`points_awarded is not null`. That is equivalent to "not unresolvable" **by
construction**, not by luck — `predictions_unresolvable_has_no_points`
(migration 0079) makes it impossible for an unresolvable row to carry points.
Re-expressing that filter as `resolution is not null` would silently include
unresolvable rows, whose `points_awarded` is null, and every one of them would
read as a miss. There is a test named for exactly that mistake.

### Activity streak — consecutive days you earned something

`get_activity_streak` (migration 0037, amended by 0100). Derived live from
`xp_ledger`, no separate table, so "active" has one definition.

Migration 0100 exists because `reconcileXp` broke the original. The function
counted distinct dates with *any* ledger row, which was exactly right while
every row was an award. A negative reconciliation row is dated when the
correction happened, not when the user played — so an admin re-scoring a
fixture on a Tuesday would have marked Tuesday "active" for every affected
user, inventing streak days for people who never opened the app. Only rows with
`amount > 0` now count. `/rewards`' week strip carries the same filter, so the
strip and the streak pill on one screen cannot disagree.

Day boundaries are UTC. `profiles.timezone` now exists and this has not been
migrated onto it yet — a real, known inaccuracy for users far from UTC, not a
design choice.

---

## 4. Badges

- **Awarded by:** `awardBadge` (a named code) and `evaluateBadgeCriteria` (the
  data-driven catalogue), both in `src/lib/rewards.ts`, both service-role only.
  Real callers exist on posting, onboarding and prediction scoring — the
  catalogue is not decorative.
- **Idempotent:** `user_badges_unique (profile_id, badge_id)`. A 23505 is
  treated as success. `evaluate_badge_criteria` additionally skips anything
  already held rather than relying on swallowing the conflict.
- **Earned twice:** impossible. The unique constraint is the guarantee.
- **Lost:** never. `evaluate_badge_criteria` is deliberately additive-only and
  does not revoke a badge whose underlying count later drops. A badge records
  that something happened; revoking one because a user tidied up their own old
  posts would be hostile. This is a stated policy, in that function's own
  comment, not an oversight.
- **Criteria** (migration 0073) are `{"fact": <key>, "threshold": <int>}` where
  `fact` resolves against a hand-written whitelist inside
  `private.count_badge_fact`. Deliberately not arbitrary SQL: `criteria` is
  admin-writable content, and a jsonb field that could name any table would be
  an injection surface with an admin-shaped key. An unknown fact returns
  **null**, treated as "cannot be assessed" and skipped — never zero, because
  zero would silently mean "not earned" for a condition KIVO does not
  understand.

One consequence worth knowing: the `xp_total` fact means a reconciliation that
takes XP away can leave a profile holding a badge it would no longer qualify
for. That follows directly from additive-only, and it is the intended
behaviour.

---

## 5. Leaderboards and what they rank

| Leaderboard | Ranks by | Source | Farmable? |
|---|---|---|---|
| Predictions (global) | summed `points_awarded` | `get_predictions_leaderboard`, migration 0012 | No — requires real finished fixtures and an admin scoring pass |
| Prediction leagues | same, scoped to members | `get_prediction_league_leaderboard`, migration 0075 | No, same reason |
| Fantasy leagues | scored gameweek points | `get_fantasy_league_leaderboard` | No — scored from real match data |

**There is no XP leaderboard, and that is the main structural anti-farming
control.** Every cross-user ranking in KIVO is built from events KIVO verified
against its own synced football data. XP — the one currency with any
user-controlled component — appears only on surfaces about *you*: `/rewards`,
`/profile`, `/home`, the account switcher.

Unresolvable predictions are excluded from every leaderboard automatically,
because `points_awarded` stays null and each function sums or filters on it. A
prediction KIVO could not settle costs its owner nothing and gives them nothing.

The consensus bar on a prediction card and the fan-sentiment surfaces suppress
below a real minimum sample rather than rendering a percentage off one or two
votes. Man-of-the-match predictions need `MIN_MOTM_VOTES` real votes and a
non-tied winner before they will settle at all.

---

## Verifying any of this

```
grep -rn "awardXp(\|awardSocialPostXp(\|reconcileXp(" src/    # every XP producer
npx vitest run src/lib/predictions.test.ts                    # streak + resolver invariants
npx vitest run src/lib/xp-reason-links.test.ts                # ledger line attribution
```

`src/lib/xp-policy.ts` is the single place the rules are written down. If a new
XP source is added anywhere else, it has bypassed them.
