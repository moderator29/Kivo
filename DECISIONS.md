# KIVO — Architecture & Product Decisions

Log of decisions with real consequences (irreversible, costly, or scope-defining). Routine implementation choices aren't logged here — only things a future engineer or the founder would need the "why" for.

---

### 2026-08-18 — Automated sync trigger: Supabase `pg_cron` + `pg_net`, not Vercel Cron, GitHub Actions or an external pinger

**Decision**: Schedule `/api/cron/sync-live` from inside Supabase, with `pg_cron` firing `private.trigger_live_sync()` every minute and `pg_net` making the HTTP call. Both credentials it needs — the app's base URL and the value of `CRON_SECRET` — live in Supabase Vault, so the job is **inert until the founder adds them** and requires no code change or deployment to switch on. Migration `0067_scheduled_live_sync_trigger.sql`.

**Rationale**: The worker route has been built, adaptive, quota-floored and unit-tested since 2026-08-18 with nothing calling it, because `vercel.json` no longer schedules it. Vercel Cron cannot be that caller: the Hobby plan permits **daily** crons only, and any more frequent expression fails the deployment outright. A live-scores product cannot run on one request a day, and moving off Hobby is a spend decision that belongs to the founder, not something to design around silently.

Three real alternatives were considered against that constraint:

| Option | Granularity | Why not / why yes |
|---|---|---|
| **Vercel Cron** | Daily on Hobby | Ruled out by the plan. Would need a paid upgrade — the founder's call, not an engineering workaround. |
| **GitHub Actions `schedule`** | 5 min minimum | **Rejected.** Documented five-minute floor; delays of 5-30 minutes are ordinary at peak and unavoidable (the queue is on GitHub's side, so a self-hosted runner does not help); scheduled workflows are auto-disabled after 60 days of repository inactivity. "Sometimes half an hour late, and silently off after a quiet two months" disqualifies it for live scores specifically. On a private repo the included minutes also do not survive a 5-minute cadence. |
| **External pinger** (cron-job.org, UptimeRobot) | 1 min, free | **Rejected as primary, kept as the documented fallback.** It works and needs nothing from this repository — but it puts `CRON_SECRET` in a third party's settings page with no SLA and no audit trail, and adds a vendor whose failure mode is silence. |
| **Supabase `pg_cron` + `pg_net`** | 1 min | **Chosen.** Available on every Supabase plan including free. Runs inside the infrastructure that already holds the data the worker reads and writes, so it is one fewer vendor rather than one more. The secret lives in Vault, not in a third party's dashboard and not in a migration file that lives in git forever. `cron.job_run_details` gives a real execution history neither alternative offers. |

**Consequences**:
- The worker route itself is unchanged. This is purely a caller — the six gates that decide whether a provider call is actually warranted still live in the route.
- **Nothing starts spending provider quota because of this.** `FOOTBALL_LIVE_POLLING_ENABLED` and `API_FOOTBALL_KEY` remain the founder's switches; the Vault secrets only change the worker from *never asked* to *asked once a minute*.
- Rotating `CRON_SECRET` is now a Vault edit and a Vercel edit, with no migration and no redeploy, because the function reads the secret on every fire rather than baking it in.
- `pg_cron` and `pg_net` are now installed on the live project. Additive and reversible (`cron.unschedule`, `drop function`), and the extensions are deliberately left installed on a reversal since other things may come to depend on them.
- pg_net stores every response in `net._http_response` and nothing prunes it, so a second hourly job does — six hours of retention, which is long enough to debug an overnight failure. `sync_runs` remains the durable record.
- The cron route's own no-op logging changed with it. Recording a row for every no-op was right when nothing called the route; at one call a minute the two steady-state conditions ("polling is off", "nothing is live") would each write 1,440 identical rows a day. A no-op describing a *standing condition* is now recorded once and suppressed for 30 minutes; a no-op describing something going *wrong* is still recorded every time. Nothing is lost — `cron.job_run_details` answers "did it even run" independently.

**What this does not decide**: whether KIVO should eventually move to a paid Vercel plan and use Vercel Cron. If that happens, this becomes redundant and should be unscheduled rather than left running alongside it — two schedulers calling the same worker would rely entirely on the sync lease (KN-82) to stay correct, which works, but is not a design anyone chose.

**Amended the same day, after the founder's instruction "Make it automatic — no need for triggering now" and a correction to the premise.** Vercel Cron is not entirely off the table: the Hobby plan rejects *sub-daily* schedules only, and a **daily** cron is permitted. The `crons` array had been removed because a once-a-minute entry blocked every deployment, not because crons were unavailable. That reopens a design space this entry had closed, so the answer is now three layers rather than one, each honest about what it does and does not keep fresh:

| Layer | Cadence | Needs from the founder | Keeps fresh |
|---|---|---|---|
| **On-demand freshness** (`src/lib/football/auto-sync.ts`) | Whenever somebody loads a football page and the data is already stale | **Nothing.** Runs on the deployment that exists, with the key already set | Everything, eventually — but only for the *next* visitor after a gap, and not at all on a quiet site |
| **Daily baseline** (`/api/cron/sync-daily`) | Once a day | Six lines pasted into `vercel.json` (the exact block is in `ENVIRONMENT.md`) — the route is built and deployed | Fixtures, clubs, competitions — the reference data, plus five league tables a day. Never a live scoreline |
| **Once-a-minute worker** (`/api/cron/sync-live`, pg_cron) | Every minute | Two Vault secrets **and** `FOOTBALL_LIVE_POLLING_ENABLED=true` | Live scores, properly |

The one that actually answers the founder's instruction is the first, because it is the only one that needs nothing. It uses `after()` (Next.js) so the provider call happens once the response has been sent — a slow or dead vendor can never delay a render — and it is bounded by four things, each preventing a failure that is real on 100 requests a day: a per-surface staleness threshold, a three-minute cooldown counted on *attempts* rather than successes (without which one failing sync would be retried by every page view and drain the day's quota in a minute), the sync lease from KN-82 so ten simultaneous page loads produce one sync, and the same quota floor the cron worker and Data Health's amber pill use.

**Stated plainly, because "automatic sync" is easy to over-hear**: none of this is live scores except the third row, and the third row is still the founder's switch. On-demand freshness means the first visitor after a gap sees stale data and the next one sees fresh data. A quiet site refreshes nothing.

Two rules held throughout: `FOOTBALL_LIVE_POLLING_ENABLED` is only ever *read*, never written from code — it is the founder's protection against per-minute quota burn, and the daily route skips it only because one request a day cannot burn anything, which is a different question from the one the flag asks. And `vercel.json` was deliberately left untouched by this session: deployment configuration is the founder's, and a `vercel.json` that fails validation blocks every deploy — which cost hours earlier the same day. The exact block to paste is documented in `ENVIRONMENT.md`, and it is `0 5 * * *` (daily, which Hobby accepts) against a bare path with no query string, because Vercel's cron documentation only ever shows a bare path — which is also why the daily behaviour is its own route rather than a `?mode=` parameter on the live one.

`sync_runs.trigger_source` gained `'auto'` and `'daily'` (migration `0070`) so Data Health can tell four very different quota profiles apart rather than collapsing them into "cron".

---

### 2026-08-14 — Football data provider: API-Football, free tier, provider abstraction mandatory

**Decision**: Build the `FootballDataProvider` interface now and implement it first against API-Football's free tier. Zero budget for paid football data during MVP development — do not require or assume a paid subscription anywhere in the code.

**Rationale**: Founder has $0 current budget for data providers. Sportmonks remains the researched long-term primary candidate (broader coverage, richer stats/xG/transfer data) but costs €29+/mo minimum.

**Consequences**:
- All football-entity code goes through the provider interface — no component or query ever imports `ApiFootballProvider` directly.
- Live-data polling/websocket connections are built but stay **disabled by default** (feature-flagged) until real quota is available — never silently burn the free tier's request budget.
- A development-only `MockFootballProvider` (clearly labeled, never reachable in production builds) supplies realistic fixtures for building/testing UI without spending API calls.
- `Live`, `Matches`, `Transfers`, `News` stay "Coming Soon" in the product UI until a provider is actually live end-to-end — the backend/provider architecture is built now, the UI surfaces are not faked.
- Aggressive caching and request batching are required, not optional, from the first implementation.

---

### 2026-08-14 — Authentication: Clerk, Email + X only for v1

**Decision**: Ship Clerk-based auth with Email and "Sign in with X" only for the MVP. Google and Apple sign-in are deferred, added later without an architecture change (Clerk supports this natively).

**Rationale**: Matches the original MVP scope in the master directive; avoids the extra OAuth app setup (Google Cloud Console, Apple Developer Program) blocking the auth flow from working at all in this phase.

---

### 2026-08-14 — AI Copilot: Anthropic Claude as the LLM provider

**Decision**: The AI Copilot's grounding/reasoning layer is built against the Anthropic API. The adapter is provider-agnostic at the interface level (mirroring the football-data pattern) so a different or additional model can be added later, but Claude is the only implementation for MVP.

**Consequence**: `AI Copilot` stays "Coming Soon" in the UI until `ANTHROPIC_API_KEY` is actually present — the retrieval/grounding architecture is built now; the connected, user-facing feature ships once a key exists.

---

### 2026-08-14 — Auth architecture supersedes the original PDF instruction

**Decision**: Clerk is the identity authority; Supabase is application-data-only via Supabase's native third-party auth integration (JWKS-based, trusts Clerk JWTs directly). This explicitly overrides the "Use Supabase Auth as the source of truth" instruction found in the original Master Directive PDF — the founder's later chat message is the authoritative, current instruction. See `KIVO_BUILD_ACKNOWLEDGEMENT.md` for the full rationale.

---

### 2026-08-14 — Two-agent model clarified

**Decision**: "Agent 1" (Product/UX/Research) and "Agent 2" (Engineering/QA/Data) are implemented as task-scoped subagent dispatches from the primary build session, not standing background processes. Each is given a complete, self-contained brief and reports back once; the next task is queued immediately on completion so neither sits idle. This is a mechanism clarification, not a scope reduction — the directive's two-role split is honored.

---

### 2026-08-15 — Account deletion: privacy-first hard delete, no tombstone, no export

**Decision**: Clerk's `user.deleted` webhook (`src/app/api/webhooks/clerk/route.ts`) hard-deletes the `profiles` row for the departing user. Every FK-cascaded row — posts, comments, reactions, predictions, fantasy teams/rosters, XP ledger entries, badges, follows, notifications — is removed with it via `on delete cascade`. There is no soft-delete flag, no tombstone row, and no data-export step offered before deletion.

**Rationale**: This is the more privacy-protective default for a v1 launch with no data-retention policy, no export tooling, and no legal review of what a "deleted but retained" user record would need to look like (right-to-erasure posture, retention limits, etc.). Building a correct tombstone/soft-delete system — one that actually satisfies erasure requests rather than just hiding data — is a larger, deliberate product and legal decision, not a default to fall into as a side effect of a security-hardening pass. Hard delete is the safer failure mode until that design work happens.

**Consequences**:
- **Orphaned social threads.** A deleted user's posts and comments disappear entirely, including ones that were the parent of a still-existing reply. A reply left by a user who is still on the platform can end up displayed as a reply to nothing, because the parent row is gone, not merely blanked. Any UI rendering a comment/reply thread needs to already tolerate a missing parent (this is a pre-existing rendering concern, not new behavior introduced by this entry).
- **No self-service export.** A user who deletes their account cannot recover their post history, predictions, fantasy history, or XP afterward — deletion is immediate and irreversible. There is no "download your data first" step in the current account-deletion flow (`src/app/(app)/settings/actions.ts` `deleteAccount`).
- **No grace period.** Deletion is not soft/delayed; there is no undo window.
- **Future work, if this needs to change**: a soft-delete/tombstone approach (e.g. anonymizing `profiles` in place and leaving a placeholder for authored content instead of cascading the delete) is a real behavior change with product and legal implications beyond a cleanup pass, and should be scoped and decided on its own, not folded into an unrelated change.

---

### 2026-08-15 — Premium stats readiness: market value, contract expiry, heat maps (schema + seam only, no vendor connected)

**Decision**: Build the nullable-schema + gated-UI + provider-seam plumbing for three data categories API-Football's free tier doesn't supply — player market value, contract expiry, and per-player per-match pitch heat maps — without connecting a real vendor or fabricating any value. The founder is now willing to pay for a real data vendor for these three fields (a change from the $0-budget MVP posture in the API-Football decision above) but does not yet have API keys for one.

**What was built**:
- `supabase/migrations/0036_premium_stats_readiness.sql` — nullable `players.market_value_eur`, `players.market_value_updated_at`, `players.contract_expires_at`; nullable `lineups.pitch_heatmap` (jsonb touch-count zone grid, documented shape in the migration). Every column is null on every existing row and stays that way until a real vendor writes to it.
- `src/lib/football/premium-stats.ts` — `isPremiumStatsConfigured()` (mirrors `isAiConfigured()` in `src/lib/ai/client.ts`, gated on `SPORTMONKS_API_TOKEN`) plus a typed, deliberately unimplemented `PremiumStatsProvider` interface/stub. Not wired into `getFootballDataProvider()` or the `FootballDataProvider` interface — those are shared by every provider implementation (including the mock) and this seam is speculative until a vendor is actually chosen.
- Gated display on the player profile page (`src/app/(app)/players/[id]/page.tsx`): a "Market" section that only renders when `market_value_eur` or `contract_expires_at` is non-null. Since both are null for every player today, nothing new is visible in the running app. No heat map viewing surface was built in this pass — the match lineup/pitch UI was mid-flight in a concurrent change at the time, and the brief marked a heat map viewer as optional; the schema and provider seam are ready for one whenever it's built.

**Vendor research findings** (condensed; see git history / the original research pass for detail):
- **Market value & contract expiry**: no official Transfermarkt API exists; unofficial scrapers are legally gray and conflict with this project's own no-scraping policy (migration 0007, RECOMMENDATIONS.md item 179) — not pursued. Sportmonks (from €29/mo) exposes real `transfers`/`pendingTransfers` player data, which plausibly covers contract expiry, but whether it exposes market value at all is **unconfirmed** in their public docs.
- **Heat maps**: true per-touch pitch data is an Opta/StatsBomb/Wyscout-tier product; Opta and StatsBomb are enterprise-only with no public pricing. Wyscout (via Hudl) starts around $325/year and is the most accessible real option found, though exact heatmap-endpoint availability at that tier is unconfirmed. Sportmonks offers ball-position/event data that could approximate activity zones but has no dedicated heatmap endpoint — any such visualization would be derived/approximate, not authoritative, and must be labelled as such if ever built.

**Status**: No live integration exists. `isPremiumStatsConfigured()` returns `false` and `getPremiumStatsProvider()` throws until `SPORTMONKS_API_TOKEN` (or an equivalent vendor credential) is actually set — pending the founder buying a real API key.

**2026-08-15 audit update — this is genuinely NOT "add key and it works"**: unlike `API_FOOTBALL_KEY`/`ANTHROPIC_API_KEY`, setting `SPORTMONKS_API_TOKEN` alone does nothing — `isPremiumStatsConfigured()` flips to `true` but `getPremiumStatsProvider()` still unconditionally throws ("configured but not implemented yet"), because there is no HTTP client written against Sportmonks at all. A scoped implementation plan (candidate v3 endpoints/includes for market value, contract expiry, and heatmap data, plus the auth/request-shape differences from the API-Football adapter) is now documented directly in `src/lib/football/premium-stats.ts` above `getPremiumStatsProvider()`, written from Sportmonks' publicly known v3 conventions — **not verified against a live account** (this session's outbound access to docs.sportmonks.com was blocked; nothing below the "unconfirmed" line above should be treated as confirmed until checked against a real response). That plan is meant to make the actual follow-up build a short, well-scoped pass — confirm the real endpoint/include/field names against a live Sportmonks account first — rather than a fresh investigation.

**⚠️ SUPERSEDED 2026-08-15 (same day, later pass) — see the entry directly below.** Everything above this line is kept as the historical record of the research that was actually done; none of it should be read as still-current status.

---

### 2026-08-15 (later same day) — Sportmonks removed entirely; TheSportsDB is the second provider instead

**Decision**: The founder explicitly decided against Sportmonks. Every Sportmonks-shaped artifact from the entry above was removed: `src/lib/football/premium-stats.ts` (deleted outright), the gated "Market" section on the player profile page (`src/app/(app)/players/[id]/page.tsx`), the `SPORTMONKS_API_TOKEN` env var (every mention across `.env.example`, `ENVIRONMENT.md`, `RECOMMENDATIONS.md`, `next.config.ts`), and the `players.market_value_eur` / `players.market_value_updated_at` / `players.contract_expires_at` columns added by migration 0036 (dropped by migration `0039_drop_premium_stats_market_columns.sql`).

**What was NOT dropped, and why**: `lineups.pitch_heatmap` (also added by 0036) is left in place, untouched, permanently null, unreferenced by any code. A sibling work stream was actively building the real heatmap feature (`HeatmapEngine`/`PositionalDataProvider`) in this same session, touching `src/lib/football/heatmap*`/`positional*`. That column sits squarely inside that work's schema surface — dropping or renaming it here, concurrently and without visibility into what that work stream already assumes, risked a real collision on a shared table in a shared database. It costs nothing to leave a null, unreferenced jsonb column in place; it costs a broken build or lost work to guess wrong about someone else's in-flight schema. Whoever finishes the heatmap engine should decide whether to reuse, rename, or drop it, with full context this pass didn't have.

**Replacement provider**: `src/lib/football/providers/thesportsdb.ts` implements the existing `FootballDataProvider` interface against TheSportsDB's real v1 JSON API (`https://www.thesportsdb.com/api/v1/json/{key}/...`, key embedded in the URL path, no request header). Selected via `FOOTBALL_DATA_PROVIDER=thesportsdb` (default stays `api-football` — this is additive, not a replacement; API-Football remains primary per the founder's own standing directive). See `docs/PROVIDER_ABSTRACTION.md` for the endpoint-by-endpoint capability map and `docs/API_FOOTBALL.md`/the provider file's own doc comments for exactly what's confirmed vs. inferred from cross-referenced third-party sources (this sandbox's egress to `thesportsdb.com` itself is blocked, same class of restriction that blocked `docs.sportmonks.com` in the entry above — TheSportsDB's actual endpoint catalog, parameters, and known free-tier restrictions were instead cross-verified across multiple independent, mutually-consistent public sources: an official endpoint list encoded in a long-standing open-source Python client, community documentation threads, and search-indexed snippets of TheSportsDB's own docs pages). Where a capability's exact response shape couldn't be cross-verified with confidence (event-level goal/card timelines, per-fixture statistics, lineups, a distinct "current manager" entity, transfer history), the provider throws a clear "not supported by this provider" error rather than guessing at a shape — never fabricated data to fill the gap.

---

### 2026-08-18 — Real, adaptive Vercel Cron worker built; "$0 budget, no cron or polling" is superseded

**Decision**: The founder directed that the automated live-sync worker `docs/LIVE_DATA.md` had always listed as "NOT BUILT" (deliberately, pending quota protection/dedup/health-monitoring prerequisites) now be built for real, the way an industry-standard sports platform (ESPN, Sofascore) actually does it: poll aggressively only when it matters, rarely otherwise, never a fixed interval blind to state. This explicitly supersedes the earlier "$0 provider budget with no cron or polling" framing in `RECOMMENDATIONS.md`'s introduction (see that file's own 2026-08-18 annotation) — not because the $0-budget constraint changed, but because the founder judged the missing prerequisites (dedup, quota-awareness, a real worker) were exactly what made an automated poller unsafe before, and directed they be built now rather than staying permanently deferred.

**What was built**:
- `src/app/api/cron/sync-live/route.ts` — a Vercel Cron target, fired every minute (`vercel.json`'s `crons` array), that performs no provider call unless every one of its guards passes: `CRON_SECRET` auth, `FOOTBALL_LIVE_POLLING_ENABLED`, a real provider configured, dedup (no other cron-triggered run already `running` in the last 2 minutes), a quota safety floor (10 requests remaining, reasoning in the route's own comment), and finally an actual check for live/halftime/imminent fixtures in already-synced data. Only then does it call the existing `syncTodayFixtures`, now accepting an optional `triggerSource` so its `sync_runs` row reads `'cron'` instead of the default `'manual'`.
- Migration `0044_cron_live_worker.sql` — `sync_status` gains a `'skipped'` value (a no-op decision is genuinely not running/success/partial/failed), and `sync_runs` gains `trigger_source` (`'manual'` default | `'cron'`), applied to the live Supabase project (`gkyjfihxxdynfwqhhpyn`) via the Supabase MCP, with `src/lib/supabase/types.ts` regenerated against it, not hand-edited.
- Admin → Data Health gained a dedicated "Automated worker" section, separate from the pre-existing "Recent sync runs" list (now filtered to manual runs only so cron's once-a-minute cadence can't crowd it out) — showing the worker's last 8 decisions and a stale/"not checking in" indicator if it hasn't logged anything in over 5 minutes.

**What explicitly did NOT change**: `FOOTBALL_LIVE_POLLING_ENABLED` stays `false`/unset by default — this pass built the infrastructure to safely support flipping it, and left the actual flip to the founder, in Vercel, whenever they decide the account can absorb the resulting request volume. Nothing in this pass flips it, ignores it, or makes the route treat it as anything other than the real gate it already was.

**What could not be verified from this sandbox**: whether Vercel's real Cron infrastructure genuinely invokes this route on schedule once deployed. There is no way to deploy to Vercel, wait for its scheduler, or inspect its Cron Jobs dashboard from here. The route's own logic was verified by direct reading, and by `tsc`/`eslint`/`build`/`test` all passing; a real observed firing was not. See `docs/LIVE_DATA.md`'s "What genuinely can't be verified from this sandbox" section — Data Health's new "Automated worker" panel is the intended way to confirm this after a real deploy.

---

### 2026-08-18 (later same day) — Match Room made genuinely live; auto-append instead of copying `/social`'s click-to-reveal pill

**Decision**: Per the founder's "live match chats... auto chats open in there so people can be talking about the match live" directive, Match Centre's existing Room tab (fixture-scoped `posts`, `src/components/matches/match-room.tsx`) gets real-time push via Supabase Realtime — the same `posts` publication `0042_realtime_posts` already added for `/social`'s own live signal. The open design question was whether Room should reuse `/social`'s exact pattern (a dismissible "New posts" pill the reader clicks) or auto-insert arrivals directly. **Auto-append, no click required**, was chosen — but only after checking the feed's own stated reason for its pill against Room specifically, not assuming it transfers because the underlying table is the same.

**Rationale**: `/social`'s pill exists because a reader can be genuinely mid-article there, and an unrequested insert would be jarring — see `social-feed.tsx`'s own comment. That risk doesn't hold for a Match Room the same way: a Room exists only to watch one specific live match, opened specifically to see what happens next as it happens — there is no "mid-article" state to protect. It's also structurally softer than a naive chat log: both surfaces render newest-first, so an arrival is *prepended*, appearing above whatever the viewer is currently reading rather than injected mid-scroll under their cursor. A viewer scrolled into older Room history keeps their position; a viewer at the top (the common "watching it live" case) sees the new post animate in immediately — which is also what makes this task's system-authored goal/red-card announcements (RECOMMENDATIONS item 254) actually read as "live": a goal alert nobody sees without a manual click isn't a live match room.

**What was built**:
- `src/hooks/use-realtime-room-posts.ts` — subscribes to `postgres_changes` INSERT on `posts`, server-side filtered to one fixture (`filter: fixture_id=eq.<id>`, a deliberate divergence from `use-realtime-fixtures.ts`/`social-feed.tsx`'s client-side-filtered subscriptions — those two genuinely need an unbounded scope, a Room does not), merges every arrival in immediately. A system post renders off the row alone (`is_system` — no lookup needed); a real user's post resolves author identity via the same `get_public_profiles` RPC every other cross-user author lookup in this app already uses, never a placeholder.
- `src/components/matches/room-composer.tsx` — a lighter, single-line composer purpose-built for Room (RECOMMENDATIONS item 3), replacing the general `PostComposer` there. Still calls the exact same `createPost` server action (same rate limit, same moderation enforcement, same 2000-char cap) — only the presentational shell changed.
- `src/lib/football/match-room-system-posts.ts` + migration `0047_match_room_system_posts.sql` — item 254, detailed in `RECOMMENDATIONS.md`'s own resolved entry rather than repeated here.

**Verified, not assumed**: the moderation-status system built earlier tonight (`0045_moderation_status.sql`) was confirmed — live, against project `gkyjfihxxdynfwqhhpyn`, not just read — to already cover Room posts with zero extra code (same `posts` table, same RLS), and `scripts/verify-rls.sql` section 6j now carries that as permanent regression coverage (a suspended user's Room-post insert, and a shadow-muted user's Room post, behave identically to their general-feed equivalents in section 6i).

---

### 2026-08-18 (later same day) — No provider failover: KIVO runs one football data provider at a time, by design

**Decision**: `getFootballDataProvider()` (`src/lib/football/index.ts`) selects exactly one provider instance via `FOOTBALL_DATA_PROVIDER` and caches it for the process lifetime. There is no runtime primary/secondary/fallback chain anywhere in the codebase — if the active provider fails outright or exhausts its daily quota mid-sync, nothing automatically retries against a second provider.

**Rationale**: This directly narrows the founding brief's own architecture commitment ("No API provider is a single point of failure — primary/secondary/fallback with graceful degradation") — narrowed deliberately, not by oversight, per the reasoning already written as a code comment in `src/lib/football/index.ts` before this entry existed: real failover would require deciding how to reconcile two providers' ids for the same real-world entity (a team, a fixture, a player) when both report on it — a genuinely separate, larger feature (probably its own `provider_mappings`-merge design), not a small addition on top of the existing single-provider sync path. Building it speculatively, before a second provider is ever actually needed live in production, risked exactly the kind of premature architecture this project's own discipline warns against elsewhere.

**What this decision does NOT mean**: a provider outage or quota exhaustion does not break a page a user is actively viewing. Every public KIVO surface (`/teams`, `/matches`, `/live`, Match Centre, etc.) only ever reads already-synced rows from Supabase — none of them call a `FootballDataProvider` adapter directly (confirmed by grep: zero client-facing routes import a provider adapter). A provider failure only affects the next admin-triggered (or cron-triggered) sync attempt, which already surfaces a specific, honest error — "quota exhausted" is distinguished from "bad key" is distinguished from a generic 5xx (RECOMMENDATIONS.md item 54) — rather than silently degrading a page someone is looking at. A real, visible freshness indicator (`last-synced-note.tsx`, item 60) is also already shipped independently of this decision.

**Consequence**: if API-Football (the primary) goes down or exhausts quota, KIVO does not automatically retry against TheSportsDB (the secondary) mid-sync. An operator would need to manually flip `FOOTBALL_DATA_PROVIDER` and re-trigger a sync. This is a real, accepted gap in the "no single point of failure" ambition — tracked as RECOMMENDATIONS.md item 298 — not a secret one; this entry exists specifically so it's findable outside a code comment.

**Future work, if this needs to change**: an entity-reconciliation layer (deciding how a fixture/team/player synced from two different providers maps to the same KIVO row) would need to exist before real failover is safe to build. Scoping and building that is a deliberate, separate decision, not a default to fall into.


---

### 2026-08-18 (later same day) — Auth re-platformed: Clerk removed entirely, Supabase Auth with email one-time codes only

**Decision**: Clerk is gone from KIVO — dependency, components, webhook, middleware, CSP allowlist and all. Supabase Auth is the identity authority, and the only sign-in method is an emailed one-time code. No password. No social provider enabled.

This reverses the 2026-08-14 entry two above ("Clerk is the identity authority; Supabase is application-data-only") and, with it, that entry's own override of the original Master Directive PDF. The PDF's instruction — "use Supabase Auth as the source of truth" — is what KIVO actually does again. It is worth being blunt that this is the second reversal on the same question, not a refinement of the first.

**Rationale**: the Clerk flow could not be made to work reliably in production. The failure was not one bug: sign-up would accept an email, deliver a code, and then bounce the user back to the form on submit, with the real cause depending on the deployment (see the CSP/redeploy trap ENVIRONMENT.md documented at length, and commit db30a77's separate landing-page fix). Underneath the individual bugs sat a structural cost that made each one expensive: identity lived in one vendor and authorization in another, joined by a JWKS trust relationship that had to be registered by hand in a dashboard, keyed off a publishable key that a build-time CSP computation also depended on. Nothing in that chain was verifiable from code, and every link could break silently and look like the same symptom.

Collapsing to one vendor removes the seam rather than patching it. Concretely: the founder-only manual dashboard step is gone, the build-time-CSP-versus-runtime-key trap is gone (`next.config.ts` no longer derives anything from an auth key), the profile-sync webhook is gone, and three env vars (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`) are gone. Two npm dependencies went with it: `@clerk/nextjs`, and `svix`, which existed solely to verify that webhook's signatures.

Email-OTP-only is not just what shipped — it is a real security simplification. There is no KIVO password to store, hash, reset, phish or leak, and no password-reset flow to get wrong.

**What this cost, stated plainly** — these are real regressions, not rounding errors:

- **The "Active sessions" panel is gone.** Shipped the night before (RECOMMENDATIONS.md item 289), it listed every signed-in device with its status, last-active time, IP-geolocated city/country and browser/device, and let the user revoke any single one — all real data from Clerk's session API. **Supabase Auth has no equivalent.** Sessions live in `auth.sessions`, a schema deliberately not exposed through the API, and neither `supabase.auth` nor `supabase.auth.admin` offers list-sessions or revoke-by-id. Rebuilding the panel would have meant inventing its contents, so it was deleted rather than faked. What replaced it is the real capability that remains: a single "Sign out other devices" action (`signOut({ scope: "others" })`), whose copy claims exactly that and does not imply KIVO can see a device list. Tracked as an open gap in RECOMMENDATIONS.md item 299.
- **Nothing listens for an upstream user deletion any more.** Clerk's `user.deleted` webhook used to cascade the Supabase side when a user was removed outside the app. That listener is deleted. In its place, `profiles.auth_user_id` is `references auth.users (id) on delete cascade` (migration 0053), so a user deleted from the Supabase dashboard or via the admin API still takes their profile — and everything FK-cascaded off it — with them. This is stronger than the webhook it replaces (a database constraint cannot fail to be configured, be retried out of order, or be missing in an environment), but it is a genuinely different mechanism and worth knowing about rather than assuming continuity.
- **Existing Clerk-era accounts cannot sign in.** Migration 0053 leaves `profiles.clerk_user_id` in place and nullable rather than dropping it, precisely so those rows can still be identified. Whether they get relinked to new `auth.users` rows or discarded is a separate, destructive decision that deliberately did not ride along with the auth swap.
- **Clerk-era uploaded avatars are read-only.** The `avatars` bucket keys ownership on the first path segment, which moved from `<clerk_user_id>` to `<auth.users.id>`. Old objects stay publicly readable (no `avatar_uploaded_url` breaks) but their original owner can no longer update or delete them — which is moot, since that identity can no longer hold a session.
- **`img.clerk.com` is still in the CSP's `img-src`,** and only there. A handful of pre-migration rows have `profiles.avatar_url` pointing at Clerk-hosted photos, still rendered as `resolveAvatarSrc()`'s last fallback, including to other users. Dropping the host would have silently broken them. It stays until those rows are backfilled or nulled.

**What was deliberately NOT done**: `profiles.clerk_user_id` is not dropped, existing rows are not relinked or deleted, and no data migration of any kind rides along with the auth swap. Those are destructive and reversible-only-with-backups; they get their own decision.

**Consequence for `deleteAccount()`**: it now deletes the Supabase Auth user directly, but must first remove that user's objects from the `avatars` bucket — Supabase refuses to delete an auth user who still owns Storage objects. Without that sweep, deletion would fail for exactly the users most likely to have real data worth deleting, and the error would surface as an unrelated server fault.


---

### 2026-08-18 — Gating the app: KIVO stops publishing 11,000 URLs it no longer serves

**Decision**: `sitemap.ts` and `robots.ts` now describe only the four genuinely public pages (`/`, `/about`, `/terms`, `/privacy`). Everything else is `disallow`ed. The read-only public preview of match and entity pages is **not** built, and is left as an open question for the founder rather than assumed either way.

**Context**: the same-day move to Supabase Auth put the entire `(app)` group behind a sign-in wall with no guest preview. The SEO and sharing surface was not part of that change and kept running as built: `sitemap.ts` published nine app routes plus up to 5,000 teams, 5,000 players and 1,000 leagues; `robots.ts` explicitly allowed all of them; `generateMetadata` and `matches/[id]/opengraph-image.tsx` still existed to make shared links look good. Every one of those URLs answered a crawler — and the friend somebody sent a match link to — with a login form.

**Rationale**: continuing to advertise 11,000 URLs that all return a login wall is the same category of untruth as a fabricated statistic, just told to a search engine instead of a user. It is also actively harmful rather than merely useless: a large set of URLs that all resolve to one gate is a textbook soft-404/thin-content signal, and the cost lands on the whole domain, including the four pages that *are* real. Cutting the sitemap to the truth costs nothing today, because none of those 11,000 URLs can currently be crawled successfully anyway.

**What was deliberately NOT decided here**: whether KIVO should carve out a genuine read-only public preview for `/matches/[id]` and the team/player/league pages. That is the growth-loop question, not a correctness question, and it is a **product** call with a real trade-off on both sides:

- **For a preview**: KIVO's own stated growth loop is fans sharing match links. A shared link that opens a login form converts far worse than one that opens the match and asks for sign-in at the point of participation (reacting, posting, predicting). Every major competitor is publicly crawlable. The entity pages carry no personal data — they are public football facts — so a preview is not a privacy trade.
- **Against**: the founder's decision hours earlier was explicit that there is no guest preview of the product at all, and reintroducing one through the side door would be inventing a policy rather than implementing one.

The recommendation, stated as a recommendation and not acted on: build the preview, scoped to `/matches/[id]`, `/teams/[id]`, `/players/[id]` and `/leagues/[id]` only, read-only, with every interactive affordance routed through the existing sign-in gate (which now preserves the destination — see the same day's KN-123 work, so a preview visitor who signs in lands back on the match they were reading). That is a strictly additive change to `src/app/(app)/layout.tsx` plus these two files. Until that call is made, the honest state is the one now shipped.

---

### 2026-08-18 — Sign-in no longer confirms whether an email address has a KIVO account

**Decision**: `/sign-in` responds identically whether or not the submitted address has an account. Supabase's `otp_disabled` error (which, with `shouldCreateUser: false`, means "no such user") is swallowed on the sign-in path and the form advances to the code step either way. The message it replaced — *"No KIVO account uses that email yet. Create one instead."* — is gone.

**Rationale**: that message was a membership oracle. Anyone could feed addresses in one at a time and learn, definitively, who is on KIVO. Server-side rate limiting now exists on both auth endpoints (three sends per address and ten per IP per fifteen minutes), which makes the probe slow — but a slow leak of a user list is still a leak, and rate limiting is not the right tool for a question that should not be answerable at all. This matches the standard treatment of account enumeration on any passwordless sign-in flow.

**What the UX cost is, and what pays for it**: a user who mistypes their address now waits for an email that will never arrive, instead of being told immediately. That is a real regression and it is paid for on the code screen, which now carries a permanent, unconditional line: *"Nothing arrived at all? You may not have a KIVO account yet — create one."* Shown to everybody, so it reveals nothing, and it prompts exactly the action the old message prompted. `/sign-up` is unchanged; it creates the account or signs the existing one in, and has always answered identically either way.

**Consequence for support**: the reporter can no longer tell these cases apart, but an operator can. `docs/ACCOUNT_RECOVERY.md` §2 makes checking `auth.users` for the address the second triage step, precisely because the product deliberately will not.

---

### 2026-08-18 — The guest-affordance layer is kept behind one flag, not deleted

**Context**: KIVO used to be fully browsable signed out. Gating the whole `(app)` group (founder's call, same day) made that state structurally unreachable, and left behind a layer built for it: roughly twenty components still take a `signedIn` prop, render `<GuestLockHint>`'s padlock when it is false, and `router.push("/sign-up?redirect_url=…")` on tap. `KIVO_NEXT_GEN.md` KN-39 asked for one deliberate call — keep it behind a flag so un-gating is a config change, or delete it.

**Decision**: keep it, behind `GUEST_PREVIEW_ENABLED` in `src/lib/guest-preview.ts` (currently `false`).

**Rationale**: deleting is the tidier answer and the wrong one here for two reasons. Un-gating is a live possibility, not a hypothetical — a public read-only match page for shared links is already an open item (KN-119), and an invite-shaped preview is the obvious first growth lever for a pre-launch product. And the layer costs nothing while it sits: the components are correct, tested by use in their signed-in path, and the props are inert. What it *did* cost was legibility — twenty independent `signedIn={Boolean(profile)}` expressions with no statement anywhere of whether a guest can exist. One flag says it once.

**What was actually unacceptable, and is now fixed**: the padlock could *lie*. Inside the gate, a page whose own `getOrCreateProfile()` read transiently failed would render every control as locked and offer a signed-in user a sign-up button — an app telling a paying-attention user they do not have the account they are signed in with. `GuestLockHint` now checks the flag itself, so no call site can produce that, and `viewerIsSignedIn()` is the single derivation for the prop: while the app is gated it is unconditionally `true`, because the group's layout has already handled both the signed-out case (redirect) and the unreadable-profile case (`<ProfileUnavailable>`). A `null` profile below that is a transient failure, and the honest response to it is a control that works and reports a real error.

**Not yet done, deliberately**: the page-level call sites route through `viewerIsSignedIn` (`/ai`, `/teams/[id]`, `/players/[id]`, `/leagues/[id]`, `/matches/[id]`, `/predictions`), but `/social`, `/saved` and `/u/[username]` were being rewritten by other agents at the time and were left alone rather than merged into a conflict. Until those three are converted, flipping the flag is *almost* the whole of re-enabling a guest preview rather than all of it. The remaining edit is mechanical and named here so it is not rediscovered as a mystery.


---

### 2026-08-18 — Multi-account switching: KIVO holds several live Supabase sessions on one device

**Decision**: KIVO supports switching between accounts without signing out. Up to three inactive accounts are held alongside the active one, each in its own `httpOnly` cookie, and switching is instant — no email code, no re-verification. The switcher is a bottom sheet, "Your accounts", reached from the nav drawer's identity block and from `/profile/edit`.

**The research this rests on, because it decided the shape.** Supabase Auth has no multi-session concept. A `@supabase/ssr` client holds exactly one session, in the cookie named by its `storageKey`; `auth.sessions` lives in the `auth` schema, which is deliberately not exposed through the API, and there is no list-my-sessions or revoke-by-id call (the same wall `signOutOtherDevices()` already documents). So this could not be switched on — it had to be built.

What made it buildable safely is one property of `@supabase/ssr`: `createServerClient({ cookieOptions: { name } })` sets the client's `storageKey` to that name, and `applyServerStorage` only ever writes cookies whose name is exactly that key or that key plus a `.<n>` chunk suffix. A client bound to `kivo-account-1` therefore *cannot* touch `sb-<ref>-auth-token`, and the active client cannot touch a slot. That isolation is a property of the library rather than of our discipline, which is what makes it worth relying on. `signOut({ scope })` is unaffected by any of it: `local` ends one session, and each slot's client calls it against its own session only.

**The security decision, stated plainly because it is one.** A stored inactive session is a live credential. Anyone holding the unlocked device can tap an account in the sheet and be inside it, with no email code. That is exactly how Instagram, X and Gmail behave, and it is the entire point of the feature — but it is a genuine change to KIVO's posture and it is not going to be discovered later in a comment. It was taken deliberately, and bounded by five things that are not optional:

1. **Slot cookies are `httpOnly`; the active session's cannot be.** The browser Supabase client reads the active cookie from `document.cookie` for realtime, so `@supabase/ssr`'s default `httpOnly: false` has to stand there. Nothing client-side has any reason to read an inactive account's session, so those are locked away from JavaScript entirely, `secure` in production, `sameSite: lax`, `path: /`. The stored credential is strictly harder to steal than the active one, never easier.
2. **Identity is never taken from a cookie's claims about itself.** Every account in the sheet is resolved by `auth.getUser()` on that slot's own client — a call Supabase answers only for a session it still accepts — and the profile and XP behind it are read as that account, under its own RLS. Editing a cookie by hand cannot make the sheet display a stranger's email; it makes the slot fail verification and be cleared. It also means a session signed out from another device disappears from the sheet rather than sitting there as a row that fails when tapped.
3. **"Sign out" in the sheet revokes.** It calls Supabase's logout endpoint with that session's own access token before deleting the cookie. A control labelled "Sign out" that merely hid a live credential would be the worst thing this feature could ship. Supabase's own documented limit still applies and is not papered over: an access token already issued stays valid until it expires.
4. **Signing out of the device signs out all of them.** `signOut()` now revokes every stored slot too. The switcher is the only surface that can revoke a stored account and it lives inside the signed-in app, so without this a device whose owner had deliberately signed out would keep working sessions for two or three accounts with no screen anywhere in the product from which to reach them.
5. **An ordinary sign-in still replaces.** Keeping the previous session only happens on the explicit "Add account" path. Signing in as somebody else on a shared computer behaves exactly as it did before — the old session is replaced, not quietly made switchable.

**Switching resets server-rendered state.** `switchToStoredAccount` calls `revalidatePath("/", "layout")` before redirecting, which Next 16 documents as purging the Client Cache and invalidating all cached data (`03-api-reference/04-functions/revalidatePath.md`, "Revalidating all data"). Without it the browser keeps RSC payloads rendered for the account just left, and a back-navigation or a soft link would hand one of them to the account just arrived at. The same call runs on the add-account path, for the same reason.

**"Add account" cannot cost you the account you are using.** Nothing is stashed when the flow starts. `/sign-in?add=1` renders the ordinary email-code form to a signed-in visitor (the one case where the "already signed in, go away" redirect is skipped), and the current session is untouched until a new code actually verifies — so closing the tab at the code screen leaves the user exactly as they were. The "no free slot" refusal happens *before* `verifyOtp` is called, so a device at its limit is told so while its code is still unspent rather than after its session has already been replaced.

**Ordering, for the failure cases.** A switch performs two cookie writes — the outgoing session into the vacated slot, the incoming one into the active cookie — and either can fail, because `setSession` verifies against Supabase before it persists. The target's tokens are read and validated first (so a dead stored session is a clean "add it again" with nothing changed), then the outgoing session is written to the slot (so a failure there aborts with nothing overwritten), then the incoming session is adopted — and if *that* fails, the target is restored into its slot from the tokens still held in memory. No ordering of failures loses a session.

**What was considered and rejected.** Storing account metadata (name, handle, email) in a readable cookie so the sheet could render without network calls: rejected because the server would then be asserting an identity nobody had verified, and a hand-edited cookie would print a stranger's email address into the sheet. Resolving stored accounts through the service-role client: rejected for the same reason — possession of the session has to be what proves the identity. Refreshing stored sessions in `src/proxy.ts` alongside the active one: rejected as too much work on every request for a feature most users never touch; slots refresh lazily when the sheet opens or a switch happens, and `readStoredAccount`/`listStoredAccounts` are therefore only ever called from Server Actions, because a Server Component cannot write the rotated token back and would silently lose the account.

**Deliberate deviations from the founder's reference sheet**, both in the interest of not lying:
- The reference's right-aligned wallet balance is XP, read from the real ledger for that specific account. When it cannot be read the value renders as *nothing* — never a zero standing in for an unknown. A genuine zero renders as "0 XP", because that is a fact.
- The reference's per-row circular pencil is a sign-out. KIVO cannot edit an account it is not signed in as — every profile write goes through that account's session and RLS — so a pencil there would either do nothing or silently switch accounts first. The circular button keeps its place in the row and gets the action the surface genuinely owns; editing lives on the active card's "Edit profile" pill, which links to `/profile/edit` rather than duplicating it.

**Limit, and it is a real one**: three stored accounts, four in total. The bound is a `Cookie` header budget, not a product opinion — every stored session rides on every request to the origin, and the common proxy limit is 8-16KB of header. Slot cookies use `@supabase/ssr`'s `encode: "tokens-only"`, which keeps the user object out of the cookie and roughly halves it, but an unbounded number of slots would eventually produce a 431 that looks like the site being down and that the user cannot clear. Raising it needs a real header measured, not a guess.
