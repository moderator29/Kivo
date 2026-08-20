# Security review — adversarial pass

Written 2026-08-19, against `claude/kivo-master-build-2qijfs`, in response to the
founding directive's instruction to test KIVO "like a fan **and** like an
attacker". The fan half of that list has been worked hard all session. This is
the other half: unauthorized access attempts, RLS boundaries, rate limits, and
the named QA cases about acting outside a window you are supposed to be inside.

Migrations landed by this review: **`0095`** (prediction lock, report gate,
self-scoped breakdown, and the first fantasy-roster deadline predicate),
**`0096`** (fantasy league join boundary), **`0097`** (fantasy roster writes
become server-only). All three are applied to the live project; each header
records what was applied and when.

Method: read the policies, the grants, the SECURITY DEFINER function bodies and
every `"use server"` action, and reason about what a signed-in user can do by
talking to PostgREST directly. Where execution was needed it was **read-only** —
`pg_policies`, `pg_proc`, `information_schema`. Nothing in this review wrote
junk rows, deleted anything, or sent an email against the founder's database.

---

## The one sentence this review is really about

**A rule that only a server action enforces is not enforced.**

Supabase publishes every table in `public` to PostgREST, and the grants confirm
it: `anon` and `authenticated` hold `SELECT, INSERT, UPDATE, DELETE` on every
table in the schema. That is the intended Supabase model — RLS, not the grant,
is the boundary. The consequence is that the publishable key shipped in KIVO's
own browser bundle is a fully-functional write client for every table, and
`POST /rest/v1/<table>` never executes a single line of TypeScript.

KIVO's server actions are genuinely careful. They re-derive identity from the
session rather than trusting a passed id (**every one of the 36 does this** —
that check came back completely clean). Admin actions re-check the role
server-side rather than assuming the UI only rendered the button for people who
have it. Inputs are validated. None of that helps if the action can be skipped,
and for several tables it can.

Everything below is an instance of that shape or an exception to it.

---

## Findings

Severity is about what a motivated ordinary user can do with a browser console,
not about theoretical reachability.

### F1 — HIGH — Predictions did not lock at kickoff in the database *(fixed)*

`predictions_insert_own` checked ownership and moderation status and nothing
else. A signed-in caller could `POST /rest/v1/predictions` for a fixture that
finished last week and collect the points. With six prediction types that is up
to 24 points per already-played match, and `correct_score` — the highest-value
type at 6 points — is the easiest thing in the world to be right about when you
are reading the scoreline off the fixture row as you write it.

`predictions_update_own_unlocked` looked stronger than it was. Its guard is
`locked_at is null`, and **nothing populates `locked_at` until the admin scoring
pass runs** — which only happens after full time, and only when an admin presses
a button. Between kickoff and that press, every pick in the database was freely
editable while the match was being played.

`predictions_delete_own_unlocked` had the same weakness, with a different prize:
delete every losing pick before the scoring pass sees it and your accuracy, your
streak and your per-type breakdown all become something that never happened.

**Fixed** in `0095_rls_write_boundaries`: all three policies now require the
fixture to still be `scheduled` with `kickoff_at > now()`, exactly the rule
`submitPrediction` already applied. `locked_at is null` stays as the second
layer it was always meant to be. The admin scoring pass writes through the
service-role client and is unaffected.

### F2 — HIGH — The fantasy deadline was not in the policy *(found by the fantasy agent; fixed, in two steps)*

`fantasy_rosters_all_own` was a single `FOR ALL` policy testing team ownership
and nothing else. A user could `PATCH /rest/v1/fantasy_rosters` after kickoff
and change their captain — who scores double — their starting XI, or their whole
squad, with the results already known. Skipping the action skips every check it
performs at once: deadline, budget, formation, per-club cap.

It is worse than a typical RLS gap because nothing about the request looks
anomalous at any layer: the key is public by design, the user is legitimately
authenticated, and the rows are genuinely their own.

**Ownership note, stated plainly.** The coordinator asked me not to write this
fix because the fantasy agent was already on it. That message arrived after I
had independently found the same gap and already applied a deadline predicate as
part of `0095`. I did not revert it — re-opening a HIGH-severity hole to avoid a
merge conflict seemed like the wrong trade with deployment close — and flagged
the overlap immediately. The credit for the finding is the fantasy agent's.

**Why the first fix was not the right one.** `0095`'s deadline predicate closed
"edit after kickoff" completely and could not close "field an illegal squad
before kickoff". Budget, squad size, formation and the per-club cap are all
properties of the fifteen-row *set* being written, and a per-row `WITH CHECK`
cannot see the set. A user could still PATCH directly before the deadline and
field sixteen players, or fifteen strikers, or £300 of squad.

Three options existed, and the middle one was the trap:

- *Duplicate the squad rules into a SECURITY DEFINER SQL function.* Rejected:
  two authoritative copies of the rules in two languages fails as a squad the UI
  accepts and the database rejects, or the reverse, and nobody can tell which is
  correct.
- *Keep the partial predicate.* **The worst of the three** — it looks like
  data-layer enforcement while leaving every set-level rule wide open, which is
  the version that stops people checking.
- *Take the complete answer.* Chosen by the coordinator.

**Final state, applied as `0097`.** `fantasy_rosters` has no user-facing
INSERT/UPDATE/DELETE policy at all; with RLS on and no policy, Postgres denies
those statements by default regardless of Supabase's blanket table grants.
`setGameweekRoster`, `setFantasyCaptain` and `carryForwardFantasyRoster` write as
`service_role` and own the squad rules. `fantasy_rosters_select_own` is
deliberately kept — only the mutating statements were elevated, so every read in
the fantasy surface is still RLS-gated and ownership-scoped on every page load.
Narrowing the elevation to exactly the statements that need it is what makes
this a considered exception rather than a habit.

**Sequencing mattered and is recorded in the migration header.** Dropping the
write policies before the actions were writing as `service_role` would have
locked every manager out of their own squad. Order was: (1) the actions move to
`rosterWriter()` — commit `9603245`, content-verified off origin before
proceeding; (2) `0097` drops the policies.

**What it costs, and what buys it back.** The database no longer backstops
ownership: a bug in the action writing to another user's team would no longer be
refused down there. That is narrower than the risk it closes, and unlike the
squad rules it is *testable* — `profile` comes from `getOrCreateProfile()`, never
from an argument, and is compared against `owner_profile_id` read fresh from the
database, so a caller can influence neither side. `src/lib/server-action-identity.test.ts`
asserts that across every service-role writer, not just this one.

### F3 — HIGH — A private fantasy league could be gate-crashed *(fixed)*

The generalisation the coordinator asked for found this one, and it is socially
nastier than F2: that one lets somebody cheat their own score, this one lets a
stranger into a private league between friends.

`fantasy_teams_all_own` was `FOR ALL` with `using`/`with check` of
`owner_profile_id = private.current_profile_id()` and nothing else. Joining is
supposed to go through `redeem_invite_code` (private leagues: checks the code,
rate-limits itself, checks capacity) or `join_public_fantasy_league` (refuses
`is_private`, refuses a full league). Both are correctly written. Both were
irrelevant, because

```
POST /rest/v1/fantasy_teams
{ "owner_profile_id": "<my own id>", "league_id": "<any league at all>" }
```

satisfies the policy — the row genuinely is the caller's own.

**The answer to "is this set-level too, like the roster rules?"** Capacity and
privacy *look* per-row expressible, and writing them into a `WITH CHECK` would
have been actively worse than useless — for a reason that only appears when you
try it. **A subquery inside a policy is evaluated as the caller, so RLS applies
to it too.** `fantasy_leagues_all_own` restricts a plain read to the league's
creator and `fantasy_teams_select_own` to the caller's own teams, so

```sql
(select count(*) from fantasy_teams ft where ft.league_id = fl.id) < fl.max_teams
```

would count only the caller's own teams in that league — at most one, thanks to
`fantasy_teams_unique_owner_per_league` — and would pass unconditionally forever.
That is the "worst of three" failure again, in an even more deceptive form: a
predicate that reads correctly and enforces nothing.

**Fixed** in `0096` by stating the rule positively instead: a direct insert is
only ever for a league you created yourself (`fantasy_teams_insert_own_league`).
Every other way in is a door, both doors already exist, both already do the
checks, and both are SECURITY DEFINER so they bypass RLS. Same shape as
`prediction_league_members`, which has never had an INSERT policy and is written
only by `redeem_prediction_invite_code` — a pattern this codebase had already
validated once.

`0096` also makes `league_id` immutable via
`trg_fantasy_teams_league_id_immutable`, because the UPDATE policy has to stay
ownership-only so members can rename their team — which would otherwise leave
`PATCH` with a new `league_id` as a second front door. RLS cannot express "this
column may not change" (a `WITH CHECK` sees only the new row), so it is a
trigger, and it **raises** rather than silently dropping the change.

### F4 — MEDIUM — Every rate limit in KIVO is bypassable *(systemic; **fixed in `0103`** for posts, comments, reactions and reports)*

`consume_rate_limit` (0066) is granted to `service_role` only, and
`rate_limit_events` has RLS on with zero policies. Both are correct and
deliberate. The consequence is structural: **rate limiting exists only in the
application layer, and every rate-limited table is directly writable.**

`createPost` limits a user to 5 posts a minute. `posts_insert_own` does not.
The same holds for `comments`, `reactions`, `poll_votes`, `saves`, `follows`,
`blocks`, `fan_ratings` and `predictions` — in each case the action is throttled
and the policy behind it is not. A spam run needs a fetch loop, not an exploit.

This is not a reason to move rate limiting into the database wholesale. It is a
reason to put a coarse ceiling in the policy for the tables where flooding
actually hurts, as a backstop under the precise per-action limit. A policy
cannot write to `rate_limit_events` (no DML in a `WITH CHECK`), but it does not
need to — it can count the table's own rows:

```sql
-- Backstop only. The real limit stays in checkRateLimit; this exists so that
-- skipping the action does not also skip every limit.
create policy posts_insert_own on posts
  for insert to authenticated
  with check (
    author_profile_id = private.current_profile_id()
    and not private.is_moderation_write_blocked()
    and is_system = false
    and (
      select count(*) from posts p2
      where p2.author_profile_id = private.current_profile_id()
        and p2.created_at > now() - interval '1 minute'
    ) < 10
  );
```

**Applied in `0103`**, with three changes to the sketch above, each of which
came out of the objection the sketch itself raises.

*The threshold does not have to agree with `checkRateLimit`'s — it has to be
unreachable by anyone who passed it.* That is the reframe the whole fix turns
on. A ceiling set near the product limit is a second opinion about what a
reasonable user does, and the two copies will eventually disagree about a
legitimate request. A ceiling set an order of magnitude above it cannot: 60
posts a minute against the action's 5, 60 comments against 5, 300 reactions
against 30, 100 reports per five minutes against 10. A user who passed
`checkRateLimit` can never trip these, so no user ever sees a database error the
UI has no message for — and the only caller who can reach them is one who
skipped the action entirely, which is exactly the caller this finding is about.
It follows that **changing `checkRateLimit` does not require changing `0103`.**

*RESTRICTIVE policies rather than a rewrite of `posts_insert_own`.* Permissive
policies are OR-ed, so folding the ceiling into the existing policy leaves it
one future `create policy` away from being silently reopened. `posts_insert_own`
has also now been rewritten by three migrations (0045, 0047, 0095) for three
unrelated reasons; a fourth concern in it makes the next rewrite riskier. The
restrictive policies are AND-ed with whatever the permissive set decides, own
nothing else, and cannot be turned off by adding a policy.

*A `private` SECURITY DEFINER counter rather than an inline subquery.* An inline
`select count(*) from posts ...` inside a policy is evaluated with RLS applied
to that read, so the count is only as complete as `posts_select_public` happens
to be — and that policy is not static; it already filters shadow-muted authors
and blocked profiles. A count that quietly shrinks when an unrelated SELECT
policy grows is a backstop that quietly stops backstopping. The counters read as
owner, take no arguments, derive the profile from `private.current_profile_id()`
and return a boolean, so there is no input that could point one at another
account.

The composite indexes the sketch asks for are in the same migration
(`idx_posts_author_created_at` and its three siblings), created before the
policies.

**Confirmed by execution, unlike the rest of this document.** The mechanism was
run end-to-end inside a transaction that was then aborted, against a scratch
table carrying the identical shape — a RESTRICTIVE `INSERT` policy whose
`WITH CHECK` calls a SECURITY DEFINER counter over the same table — with the
ceiling lowered to 3 so the boundary was reachable, and with `set local role
authenticated` so RLS actually applied. That last part is the trap: the first
attempt ran as `postgres`, which bypasses RLS, and passed all four inserts — a
probe that forgets it will report a working policy that does nothing. Result:
3 inserts under the ceiling succeeded, the 4th was refused with `42501`. Nothing
was written to any real table.

Still open, deliberately: `poll_votes`, `saves`, `follows`, `blocks`,
`fan_ratings` and `predictions`. Each is bounded by a unique constraint that
caps the damage at one row per target rather than unbounded rows — a follow
flood is capped by the number of teams that exist — so they are a different and
much smaller shape of problem than free-text content, and they are not covered
by `0103`.

### F5 — MEDIUM — An MOTM poll could name players who were not in the match *(mine; fixed)*

Self-inflicted, in `0078`. `poll_options_insert_own_post` checked that the caller
owns the parent post and stopped there — fine while an option was only a label,
not fine once an option carries a real `players.id`, because that id is what
settles other people's man-of-the-match predictions.

`0078` also enforces one MOTM poll per fixture, which turns the hole into two
attacks: seed the fixture's only MOTM poll with players who never played, or
simply squat it so the legitimate poll can never be created.

**Fixed** in `0095`: a non-null `player_id` must belong to a player whose
`current_team_id` is one of the fixture's two clubs — the same rule
`submitPrediction` already applies on the prediction side. A null `player_id` is
still allowed, because that is an ordinary typed option, honestly not a verified
player.

The two mitigations already in the resolver stand and are worth keeping: MOTM
resolution needs `MIN_MOTM_VOTES` (5) real votes and refuses a tie, so a single
account could never have forced an outcome even before this fix.

### F6 — LOW-MEDIUM — A suspended account could still file reports *(fixed)*

Every user-write policy in the schema carries
`not private.is_moderation_write_blocked()`. `reports_insert_own` was the one
that did not, so a suspended or banned account kept a working write path into the
moderation queue — the one table where a punished user has the clearest motive to
make noise. Combined with F7 (no rate limit on `reportContent`) and no
uniqueness constraint on `(reporter, target)`, one account could manufacture an
unlimited pile-on against a single post, which also inflates the report-count
urgency badges the moderation queue sorts by.

**Fixed** in `0095` for the moderation half. Note the function covers only
`suspended` and `banned` — a shadow-muted account is deliberately still allowed
to write here, because a write that suddenly starts failing is exactly how a
shadow mute stops being a shadow.

### F7 — MEDIUM — `reportContent` has no rate limit *(not fixed here)*

`src/app/(app)/social/report-actions.ts` is the only user-facing write action in
the codebase with no `checkRateLimit` call at all. One-line fix, matching the
convention used everywhere else in that directory:

```ts
const rateLimit = await checkRateLimit(`user:${profile.id}`, "report_content", 10, 60 * 60);
if (!rateLimit.ok) return { error: rateLimit.error };
```

Ten reports an hour is far past any honest use. Worth pairing with a
`reports_unique_per_reporter_target unique (reporter_profile_id, target_type, target_id)`
constraint, which makes duplicate reporting impossible rather than merely slow.

### F8 — MEDIUM — Avatar and background uploads are unthrottled and never cleaned up *(not fixed here)*

`uploadAvatar` and `uploadBackground` validate MIME type and cap size at 5MB, and
the storage policy correctly ties the folder name to `auth.uid()`. Neither has a
rate limit, and neither deletes the file it supersedes — the path is
`${auth_user_id}/${Date.now()}.${ext}` with `upsert: false`, so every upload is a
new object and nothing in the codebase ever calls `.remove()` on either bucket.

A signed-in user can loop the action and write unbounded 5MB objects. That is a
real bill rather than a data breach, which is why it is MEDIUM and not HIGH.

Fix is two parts: a `checkRateLimit(..., "upload_avatar", 5, 60 * 60)` in each
action, and deleting the previous object after a successful profile update.

### F9 — LOW-MEDIUM — `profile/actions.ts` has no rate limiting at all

Seven exported actions, zero `checkRateLimit` calls — including `updateUsername`,
`updateBio`, `updateDisplayName`, `searchTeams` and `checkUsernameAvailable`.

`searchTeams` is bounded by a server-side `TEAM_PICKER_LIMIT` and correctly
escapes its LIKE pattern, so the damage is query volume rather than data.
`checkUsernameAvailable` calls a SECURITY DEFINER RPC at unlimited rate, which
makes it a username-existence oracle — mitigated by usernames being public at
`/u/<username>` anyway, so this is about load, not disclosure.

### F10 — LOW — Unvalidated values interpolated into PostgREST filter strings

`.or()` takes a hand-built string, unlike `.eq()`/`.ilike()` which bind their
values. Two call sites interpolate client-controlled input without a shape check:

1. `src/app/(app)/social/posts.ts:288` — the keyset cursor's `createdAt` and `id`
   go straight into `` `created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})` ``.
   The action's own comment argues the cursor is safe to accept from the client,
   which is true of the *values* and misses that they land in filter syntax.
2. `src/app/(app)/teams/compare/page.tsx:55` — `?a=` / `?b=` from `searchParams`.

Impact is genuinely small: RLS still applies, both tables are already
public-select, and the queries are already limited, so the worst case is an error
or a differently-filtered set of public rows. It is still the wrong default.

**Not fixed here** — (1) is the feed agent's file. `src/lib/params.ts` already
exports `isUuid` and `parseUuidParam` written for exactly this, and
`parseTransferFilters` already models the right pattern
(`raw.club && UUID_RE.test(raw.club) ? raw.club : null`). One-line fix for (1):

```ts
if (options?.cursor && isUuid(options.cursor.id) && !Number.isNaN(Date.parse(options.cursor.createdAt))) {
```

### F11 — LOW — `resolveReport` does not runtime-validate its decision

`decision: Decision` is a TypeScript union, which is erased at runtime; a crafted
call can pass any `report_status` value. The Postgres enum rejects genuine junk,
but `"pending"` and `"reviewing"` are valid enum members, so a moderator-level
caller can push a report back to `pending` while stamping `resolved_by_profile_id`
and `resolved_at` on it. Moderator-only and low-impact. Fix:

```ts
if (decision !== "actioned" && decision !== "dismissed") return { error: "Invalid decision." };
```

### F12 — INFO — `fan_ratings_update_own` omits the `finished` check its INSERT has

`fan_ratings_insert_own` requires `fixtures.status = 'finished'`; the UPDATE
policy checks only ownership. Not meaningfully exploitable — you can only update
a row you already inserted, which required a finished fixture, and fixture status
does not run backwards. Recorded for symmetry, not for action.

### F13 — LOW — Two actions accept the caller's identity as an argument *(not fixed here)*

`getQuietHours(profileId)` and `getNotificationPreferences(profileId)` in
`src/app/(app)/settings/actions.ts` both take a client-supplied profile id and
query with it, with no check that it is the caller's own.

Nothing leaks today: both use the ordinary session client and
`notification_preferences_all_own` restricts the read to
`private.current_profile_id()`, so passing somebody else's id returns no rows.
But that is RLS rescuing an action that asked the caller who they were, and the
failure is silent **in the wrong direction** — no rows reads as "no preferences
saved", so the caller is handed the *defaults* as though they were that profile's
real settings.

The severity is low; the reason it is written up at all is that it is the exact
anti-pattern this review is about, and I had already written the opposite claim
into this document before the test caught it. Fix is to drop the parameter and
read `(await getOrCreateProfile())?.id` inside, as every other action does.

Both are recorded in `KNOWN_IDENTITY_PARAM_VIOLATIONS` in
`src/lib/server-action-identity.test.ts`, so the invariant is enforced for
everything else immediately rather than waiting on a fix in another agent's file.

---

## The question the coordinator wanted answered either way: admin and moderator writes

**Answer: sound. No moderator or admin capability is reachable by an ordinary
authenticated user.** This was checked explicitly rather than assumed, because it
would have been the worst finding of the night.

The check has two halves, and both have to hold.

**Is the role in the policy, or only in the action?** In the policy, every time.
`moderation_actions_insert_moderator` requires `private.can_moderate()` *and*
`admin_profile_id = private.current_profile_id()`; `reports_update_moderator`
requires `can_moderate()`; `profiles_update_own_or_admin` and
`profiles_delete_admin` require `private.is_admin()`; `audit_log_insert_admin`
requires `is_admin()` *and* that the actor is the caller; every football-data
table, `badges`, `support_requests`, `data_anomalies`, `sync_runs`,
`provider_mappings`, `provider_coverage`, `team_aliases`, `player_aliases` and
`entity_merges` require `private.has_role([...])`. There is no admin-writable
table whose policy checks only ownership.

**Could a permissive user policy sit alongside an admin one and undercut it?**
Permissive policies OR together, so a second, looser policy on the same command
would quietly widen the first. There are none:

```sql
select tablename, cmd, count(*) from pg_policies
where schemaname='public' and cmd in ('INSERT','UPDATE','DELETE','ALL')
group by 1,2 having count(*) > 1;
-- 0 rows
```

**And the actions themselves?** `admin/moderation/actions.ts`,
`admin/users/actions.ts` and `admin/support/actions.ts` use **zero** service-role
clients — they write through the ordinary session client, so RLS is genuinely the
enforcing layer and the TypeScript check is the belt-and-braces its own comments
claim it is. `admin/users/actions.ts` additionally refuses self-targeting, which
has no RLS equivalent and would otherwise let a lone admin ban themselves out of
the product. The admin actions that *do* use the service role (football-data syncs,
prediction and fantasy scoring, entity merges) are ones where the credential is
server-only and never reaches a browser, so the action is a legitimate boundary
there rather than a bypassed one.

This is now enforced by a test rather than by this paragraph:
`server-action-identity.test.ts` fails the build if any file under `app/admin/`
exports a server action without a role check.

**A note on how that test earned its keep, and nearly did not.** Its first draft
matched a capability helper called `canViewSupportData`, which does not exist —
the real one is `canHandleSupport` — and it duly reported
`admin/support/actions.ts`, a correctly written and carefully commented file, as
a finding. A guessed allow-list is how a test starts lying about the thing it
checks. The regex is now derived from the actual exports of `src/lib/admin.ts`.

---

## A second class of finding: tightening a policy can break a legitimate writer

Worth its own heading because it is the mirror image of everything above, it bit
this review directly, and it is silent.

The `0095` deadline predicate on `fantasy_rosters` broke a real code path. The
fantasy agent caught it: `carryForwardFantasyRoster` (`src/lib/fantasy.ts`) ran
on the *user's* client and inserts roster rows for the current gameweek when
`/fantasy` loads. Under the new policy that write was refused exactly when it
needed to run — after the deadline — and it failed **silently**, so a manager who
had not opened the app that week would have seen an empty squad with the deadline
gone. No data was lost (the scorer's own carry-forward runs as `service_role`),
but between deadline and scoring the page showed nothing where their team should
be.

The fix was not to loosen the policy. Carry-forward is KIVO applying a documented
rule *on the manager's behalf*, not a manager editing a locked squad, so it never
should have run as the user; it now writes as `service_role`. That is the
opposite of a bypass.

**The generalisation, for anyone tightening a policy after this:** ask who else
writes that table, and whether any of them is acting *on the user's behalf*
rather than *at the user's request*. On-behalf-of writers legitimately need to
violate the rule you are about to encode — that is what makes them on-behalf-of —
and because most of them are fire-and-forget, the breakage does not raise, it
just quietly stops happening.

---

## Environment assumptions worth knowing

Two places where a missing key degrades behaviour rather than announcing itself.

- **`SUPABASE_SERVICE_ROLE_KEY` absent → rate limiting is off.**
  `checkRateLimit` needs the service role because `rate_limit_events` has no
  client-facing policy, and `auth-actions.ts` swallows the missing-key case to
  keep `next dev` usable. It logs loudly — *"this endpoint is unthrottled until
  that is fixed"* — which is the right handling, but a deployed environment
  missing that key is running the sign-in code endpoint with no limit at all.
- **`SUPABASE_SERVICE_ROLE_KEY` absent → fantasy carry-forward silently stops.**
  Since `0097`, `carryForwardFantasyRoster` is the only writer that can produce a
  post-deadline roster from a page load. Without the key it returns "did not
  carry" and logs rather than throwing on somebody's page load, which is the
  right failure direction — the scorer's bulk pass still catches the squad before
  scoring, so the cost is the "carried forward from GW n" notice rather than the
  squad itself. Worth knowing that the symptom is a missing notice, not an error.

---

## How to verify an RLS policy without getting a false PASS

This is the most portable thing in this document, and it belongs here rather
than only in the header of the migration that discovered it, because the next
person to test a policy will reach for exactly the same tool.

**A probe run as `postgres` bypasses RLS and reports PASS for a policy that does
nothing.** While checking the RESTRICTIVE insert ceiling in `0103`, the first
attempt ran as the default superuser and let all four inserts through — the
boundary was set at 3. Nothing was wrong with the policy; the probe simply was
not subject to it. A test that cannot fail is worse than no test, because it
retires the question.

The rule, for any RLS check anyone runs against this database:

```sql
begin;
  -- Become a role that RLS actually applies to. `postgres` is not one.
  set local role authenticated;
  -- And give the policy an identity to key off, or every
  -- private.current_profile_id() predicate silently evaluates to NULL.
  set local request.jwt.claims = '{"sub":"<a real auth user id>"}';

  -- ... the probe ...
rollback;
```

Three things make that shape the right one:

- `set local role authenticated` is what puts the session under RLS at all.
  Without it the probe measures the absence of a restriction on a superuser.
- `set local request.jwt.claims` matters just as much and fails more quietly:
  with no claim, helper functions that resolve the caller return NULL, and a
  policy comparing against NULL denies everything. That produces a *false FAIL*,
  which at least announces itself — unlike the superuser case.
- `begin` / `rollback` means the probe can write against real tables without
  leaving anything behind. Every confirmed result in this document was produced
  inside an aborted transaction.

**And confirm the probe can fail.** Lower the ceiling, or aim the check at a row
the policy should refuse, and watch it be refused — `42501` is the code to look
for. A boundary that was never crossed during the test was never tested.

---

## What the sweep found to be sound

Stating these explicitly, because a review that only lists problems gives a false
impression of the codebase and because re-checking them later is cheaper against
a written baseline.

- **No action trusts a client-supplied role.** The worst case the brief asked
  about — a moderation or admin action taking a role or a permission flag as a
  parameter — **does not exist anywhere in this codebase.** Every admin action
  re-derives the actor from the session and re-checks the role itself.
  *(An earlier draft of this document also claimed no action takes a profile id
  at all. That was wrong, and the test written to enforce the invariant is what
  caught it — see F13.)*
- **Admin authorization is checked twice.** `src/app/admin/layout.tsx` redirects
  non-admins server-side, and every admin action independently re-checks with
  `canManageFootballData` / `canViewUserData` / `canViewModerationData` /
  `canViewSupportData`. `admin/users/actions.ts` additionally refuses
  self-targeting, which has no RLS equivalent and would otherwise let a lone
  admin lock themselves out.
- **SECURITY DEFINER scope-widening: one instance, now closed.** Of the ~30
  definer functions, `get_xp_total` and `get_activity_streak` both take a
  `p_profile_id` and both already refuse to answer for anyone but the caller;
  `get_fantasy_league_leaderboard` and `get_fantasy_team_league` verify team
  ownership; `get_prediction_league_leaderboard` verifies league membership;
  `mark_notifications_read` scopes its UPDATE to the caller's own rows;
  `get_public_profile_stats` and `get_user_head_to_head` honour
  `show_activity_publicly`. The one exception was
  `get_prediction_type_breakdown` (mine, `0079`), which answered for any profile
  id passed to it — **fixed in `0095`** by adding the same
  `and p_profile_id = private.current_profile_id()` its siblings use.
- **The email path is the best-defended surface in the product.**
  `sendEmailCode` throttles per-email *and* per-IP (3 and 10 per 15 minutes),
  `verifyEmailCode` likewise (8 and 20), the code explains why either key alone
  leaves a hole, sign-in deliberately does not distinguish "no such user" to
  avoid enumeration, and the one case where throttling silently fails open —
  a missing service-role key — is logged loudly with the words "this endpoint is
  unthrottled until that is fixed". Nothing to add.
- **`profiles` self-tampering is properly locked.**
  `profiles_update_own_or_admin` pins `role` to `private.current_role()` and the
  entire moderation tuple to `private.current_moderation_raw_snapshot()`, so a
  user cannot promote themselves or clear their own suspension.
  `profiles_insert_own` forces `role = 'user'` and `moderation_status = 'active'`.
- **XP cannot be self-awarded.** `xp_ledger`, `user_badges` and `notifications`
  each carry a SELECT policy and no write policy, so with RLS enabled every
  client write is denied by default. Points come only from service-role paths.
- **Tables with no policies are genuinely closed.** `rate_limit_events` and
  `provider_request_spend` have RLS on and zero policies — default deny. The
  advisor's INFO lint on the first is expected, not a gap.
- **Filter-string interpolation is validated where it was reasoned about.**
  `parseTransferFilters` UUID-checks `club` before building an `.or()`;
  `parseUuidParam` is used on the `[id]` routes for teams, managers, transfers
  and venues; `searchTeams` escapes its LIKE pattern.
- **Pagination cannot be widened by the caller.** `loadMoreTransfers` uses a
  server-side page-size constant, and `resolveListPage` clamps `?page=` to
  `MAX_LIST_PAGES` (25) precisely so a URL cannot ask for six million rows.
- **`loadMorePosts` re-derives feed scope server-side**, with a comment saying
  why: "a filter name is safe to accept from a URL, a team id is not".
- **`blocks` cannot be self-targeted** (`blocks_not_self`), and
  `follows_insert_own` refuses a follow of an account that blocked you — a
  visibility rule correctly placed in the policy rather than the action.
- **Prediction league bounds live in the schema**, not just the action:
  `prediction_leagues_max_members_positive check (max_members between 2 and 500)`.

---

## Named QA cases from the directive

| Case | Result |
|---|---|
| Predict after lock | **Was broken, now closed.** The action always refused it; the policy did not. F1. |
| Fantasy deadline | **Was broken, now closed** — and closed properly on the second attempt: the deadline predicate of `0095` could not reach the set-level squad rules, so `0097` made roster writes server-only. F2. |
| Field an illegal squad before the deadline | **Was open under the first fix, now closed by `0097`.** Squad size, budget, formation and the per-club cap are set-level and cannot live in a per-row `WITH CHECK`. F2. |
| Join a private league without an invite | **Was broken, now closed.** F3. |
| Move a fantasy team into another league | **Was open via `PATCH`, now closed** by `trg_fantasy_teams_league_id_immutable`. F3. |
| Unauthorized admin access | **Sound.** Layout redirect plus per-action role re-check. |
| Deep link to something you may not see | **Sound** on the paths checked: fantasy league context and prediction league standings both verify ownership/membership inside the RPC; private profiles are honoured by `show_activity_publicly`; `predictions_select_own` hides other users' picks and every cross-user number goes through a narrow aggregate. |
| Rate limits | **Present and well-tuned in the actions; now backstopped at the boundary for posts, comments, reactions and reports** by `0103`. F4, F7, F8, F9. |
| Poll votes outside a window | **No gap, because there is no rule.** KIVO polls never close, so there is no window for a policy to be missing. Worth recording that MOTM predictions lock at kickoff while the poll that settles them is voted on afterwards — so a predictor can vote on their own prediction, as one vote among the `MIN_MOTM_VOTES` (5) minimum, and cannot swing a tie because a tie resolves to *unresolvable* rather than to a winner. |
| Logout / login persistence | **Not covered by this review.** Multi-account session handling was being actively rewritten by another agent while this ran, and reviewing a moving target would produce findings about code that no longer exists. Should be re-run once that lands. |

---

## Confirmed by reasoning, not by execution

Every finding above is derived from the policy text, the function bodies and the
action source, cross-checked against the live catalogue with read-only queries.
None was confirmed by actually performing the write, because doing so would mean
writing junk into the founder's database.

The two HIGH findings are unambiguous from the policy text alone — a predicate
that is not in the policy cannot be enforced by it. F3 is equally unambiguous.
F8's storage growth would need a real write to demonstrate, and is left
unconfirmed by design; the reproduction for F8 is
"call `uploadAvatar` twice and list the bucket — there will be two objects."
