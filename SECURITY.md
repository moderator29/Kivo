# KIVO — Security

The security posture as built, the decisions behind it, and the open items. Written to be checkable: every claim points at a file or a migration.

---

## 1. The model in one paragraph

Supabase issues the session JWT and Supabase verifies it, so there is no cross-vendor trust to configure and no dashboard step that, if missed, silently rejects every query (that failure mode was real under the previous Clerk architecture and is gone — see `DECISIONS.md`). Every user-owned table has RLS keyed on `private.current_profile_id()`, which resolves from `auth.uid()`. The application never decides who may read a row; Postgres does. Server code runs under the caller's session by default, and reaches for the service-role client only where it legitimately writes onto somebody else's row — always with a comment saying why.

---

## 2. Authentication

- **Email and password** since 2026-08-19, with an emailed six-digit code kept as a secondary way in and `/forgot-password` for recovery. No social providers. (This section previously read "No password, so there is no password to leak, reuse or stuff" — that stopped being true; see `DECISIONS.md`, "KIVO has passwords again", for what replaced the simplification.)
- **Password rules are enforced in the Server Action, not the form**: ten characters, a letter, a number, 72 bytes maximum. `src/lib/auth-shared.ts` holds the single definition that both the form and the action import, so what a user is shown before submitting is what judges them after.
- **Every password endpoint is rate-limited** through `consume_rate_limit`, on the address AND the IP: sign-in 10/40 per fifteen minutes, sign-up 3/10 per fifteen minutes, reset 3/10 per *hour*. The per-IP budget is the one that bites credential stuffing, which sprays one guess across many addresses rather than hammering one.
- **Leaked-password protection is a founder action and is currently OFF** — see §9 and `docs/DEPLOYING.md` step 9.
- Sign-in does **not** disclose whether an account exists — the same response either way. That was a real fix, not a default (see the "stop sign-in answering who has an account" commit).
- The sign-in email does not trust a caller-supplied host header for its redirect. Same commit.
- **Multi-account** (up to four on one device): each inactive session lives in its own `httpOnly` cookie, isolated by `@supabase/ssr`'s `storageKey` mechanism rather than by our own discipline. Identity is always re-verified with `auth.getUser()` against that slot's own session — a hand-edited cookie makes a slot fail verification and be cleared, never makes the switcher display a stranger. "Sign out" genuinely revokes; signing out of the device revokes every stored slot. Full reasoning, including the deliberate posture change, in `DECISIONS.md`.

A stored inactive session is a live credential and anyone holding the unlocked device can switch into it. That is how every major app behaves and it is the point of the feature — it is recorded as a decision rather than left to be discovered.

---

## 3. Authorization

### RLS

Enabled on every user-owned table. The patterns, and there are only a few:

- **Own-row**: `profile_id = private.current_profile_id()`. Used by `predictions`, `follows`, `saves`, `blocks`, `fan_ratings`, `notifications`, `poll_votes`, `notification_preferences`.
- **Public-read, admin-write**: football reference data — `teams`, `players`, `fixtures`, `fixture_events`, `lineups`, `standings`, `team_aliases`, `player_aliases`.
- **Admin-only**: `provider_mappings`, `sync_runs`, `data_anomalies`, `entity_merges`, `audit_log`, `reports`, `moderation_actions`.

Rules that are encoded in the policy rather than in the server action, deliberately, because a policy cannot be forgotten by a future write path:

- A prediction cannot be changed after `locked_at` is set (`predictions_update_own_unlocked`).
- A fan rating cannot be submitted before the whistle (`fan_ratings_insert_own` requires `status = 'finished'`).
- A suspended or banned user cannot write anything (`private.is_moderation_write_blocked()`, on every `*_insert_own`).
- A shadow-muted author's posts are invisible to everyone but themselves and admins.
- A follow cannot cross a block.

### Roles

Seven, server-verified: `super_admin`, `admin`, `moderator`, `football_data_admin`, `content_admin`, `support_admin`, `analyst`. `private.has_role(array[...])` is called inside the policy. There is no frontend role check that grants anything — the admin UI hides what you cannot do, and the database refuses it regardless.

### The `anon` surface

Essentially closed. Migration 0059 was a deliberate sweep, and every migration since states its grants in full rather than inheriting them, because this project's default privileges grant `EXECUTE` on a new public function to `anon` — a footgun that has bitten three times (`prune_sync_runs`, `get_my_followers`, and the 0059 sweep itself).

`create or replace` is preferred over drop-and-recreate for the same reason: a recreated function silently loses its grants, and that has happened here.

---

## 4. `SECURITY DEFINER`

Used where RLS correctly prevents a query that the product legitimately needs — a cross-user aggregate, or a check that must see both sides of a relationship. The discipline, applied without exception:

1. **`set search_path`** on every one, so a caller cannot shadow a table or function name.
2. **Return the narrowest possible thing.** `get_predictions_leaderboard` returns usernames and summed points, never an individual pick. `get_poll_results_for_posts` returns counts, never a voter.
3. **Explicit grants**, revoked from `public` and `anon` first.
4. **Pipeline-internal functions go to `service_role` only** — `record_entity_alias`, `notification_payload_is_valid`, `record_data_anomaly`.
5. **Anything that must not be reachable at all lives in the `private` schema**, which is not exposed through PostgREST. `private.blocked_profile_ids()` is the clearest case: it computes both directions of a block relationship, and exposing it would let somebody deduce that they had been blocked.

---

## 5. Privacy

- **A block cannot be detected by the person it applies to.** No query separates "A blocked me" from "A has no posts". A refused follow returns the same generic failure as any other error. New notifications are never produced; old ones are filtered from the *blocker's* list only, because deleting rows from someone else's notifications would be a visible event on their account.
- **KIVO never infers a timezone from an IP address.** `profiles.timezone` is written only from the user's own statement, and every consumer falls back to UTC and says so.
- **Profile privacy** (`show_activity_publicly`) is enforced in the RPC that serves a public profile, not in the component.
- **Data export** (`export_user_data`, 3 per 5 minutes) returns the caller's own rows.
- **Account deletion** exists as a real flow at `/settings/delete-account`.
- **The AI is grounded**: only verified KIVO rows enter a prompt. Another user's private data is not in the retrieval set because the retrieval runs under the caller's own session.

---

## 6. Input handling and abuse

- **Rate limits on every write**, enforced in Postgres (`consume_rate_limit`, migration 0066) rather than in application memory, so a limit survives a serverless instance being replaced mid-window. Values in `API.md`.
- **Server-side validation before the database**, so a constraint violation is a readable sentence rather than a Postgres error code.
- **Column allow-lists** where a client names a column — `updateNotificationPreference` can only ever be pointed at one of eight known columns.
- **No string interpolation into SQL.** Search goes through `resolve_football_entities` with a `text[]` parameter, precisely so an `ilike` pattern never has to be built by concatenation.
- **Polymorphic ids are re-derived server-side**: `poll_votes.post_id` is overwritten by a `BEFORE INSERT` trigger from the option's real parent, so a vote cannot be attached to the wrong poll.
- **XP is idempotent and bounded**: every award carries a `source_key`, and posting XP has a real daily allowance.

---

## 7. Secrets

- **No secret is ever `NEXT_PUBLIC_`.** `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `API_FOOTBALL_KEY`, `THE_SPORTS_DB_API_KEY` and `CRON_SECRET` are all server-only.
- **Football providers are never called from the browser** — a provider key in client code would be readable by anyone who opened devtools.
- **Cron routes require a bearer secret**, compared in constant time, and do not accept a session.
- **Vault** holds the two credentials `pg_cron`/`pg_net` needs to call the live worker, so the scheduled job is inert until the founder adds them and needs no deploy to switch on.

---

## 8. Auditability

- `audit_log` records every sensitive admin action, with the actor.
- `moderation_actions` records every moderation decision.
- `entity_merges` stores the removed row in full, so a merge can be described and reversed after the fact.
- `data_anomalies` records a detected data conflict with both values that disagreed, plus a review workflow whose `WITH CHECK` stops an admin clearing a review or attributing it to somebody else.
- `sync_runs` and `sync_run_failures` make a partial sync a queryable list rather than a truncated sentence.

---

## 9. Open items

Stated rather than buried.

| Item | Status |
|---|---|
| Leaked-password protection | **Disabled, and now it matters.** This row used to read "Not applicable — KIVO has no passwords". KIVO has passwords as of 2026-08-19, so the advisor's warning is a real finding. It is a dashboard toggle that cannot be set from code: Supabase → Authentication → Sign In / Providers → Email → "Prevent use of leaked passwords". Founder action, written up in `docs/DEPLOYING.md` step 9. |
| `pg_net` in the `public` schema | Advisor warning. Supabase installs it there; moving it is a Supabase-side operation. |
| `auth_rls_initplan` on three `profiles` policies | Performance advisory, not a security hole: `auth.<fn>()` re-evaluates per row. Fix is `(select auth.fn())`. Untouched because rewriting those three policies is a change to the identity path and wants its own careful pass. |
| `rate_limit_events`, `provider_request_spend` | RLS enabled, no policies — deliberate. Nothing may read them through PostgREST; they are written by `SECURITY DEFINER` functions only. The advisor reports the shape, not a leak. |
| Custom SMTP | Not configured. Supabase's built-in sender is rate-limited to a handful of messages per hour — fine for testing, not for launch. Founder-side. |
| Penetration testing | Never performed. |
| Dependency scanning in CI | Not wired up. |

---

## 10. Reporting

There is no published security contact yet. Before launch, `/support` should route a security report to a real mailbox rather than into the general support queue.
