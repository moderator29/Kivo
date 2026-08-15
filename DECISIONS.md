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
