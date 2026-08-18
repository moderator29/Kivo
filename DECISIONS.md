# KIVO — Architecture & Product Decisions

Log of decisions with real consequences (irreversible, costly, or scope-defining). Routine implementation choices aren't logged here — only things a future engineer or the founder would need the "why" for.

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
