# KIVO — API

What KIVO exposes, what it calls, and what it deliberately does not have. Written from the code, not from a plan: every route, action and function named here exists at the path given.

The short version: **KIVO has almost no HTTP API, and that is the design.** There are six route handlers in the whole product, and none of them is a data API. Everything a user does goes through a Server Action; everything a page shows is fetched in a Server Component. There is no `/api/posts`, no `/api/fixtures`, and no JSON surface for the football data — because there is no client that needs one, and every endpoint that exists is an endpoint that has to be secured, versioned, rate-limited and documented forever.

---

## 1. Route handlers

Six, and each one exists because a Server Action genuinely could not do the job.

| Route | Method | Auth | Why it is a route and not an action |
|---|---|---|---|
| `src/app/api/ai/chat/route.ts` | POST | Signed-in | Streams. A Server Action returns a value; this returns tokens as the model produces them. |
| `src/app/api/cron/sync-daily/route.ts` | POST/GET | `CRON_SECRET` bearer | Called by a scheduler, which has no session and cannot invoke an action. |
| `src/app/api/cron/sync-live/route.ts` | POST/GET | `CRON_SECRET` bearer | Same. Adaptive live-score worker. |
| `src/app/api/health/route.ts` | GET | Public | Uptime probe. Deliberately reachable without a session. |
| `src/app/auth/callback/route.ts` | GET | Public | Supabase redirects a browser here with a code in the URL. A redirect target must be a route. |
| `src/app/admin/preview-mode/route.ts` | GET | Admin | Sets a cookie and redirects. |

Anything not on this list does not exist as an endpoint. If you are looking for where a feature's writes happen, it is a Server Action.

### Cron authentication

Both cron routes require `Authorization: Bearer $CRON_SECRET`. They do not accept a session, and a signed-in admin cannot trigger them from the browser — the admin equivalents are separate Server Actions with a real role check. The secret is compared with a constant-time comparison, and a request without it gets `401` with no detail about why.

### The health route

`GET /api/health` is the only genuinely public endpoint. It reports process liveness. It does not report database state, provider state, or anything an attacker could use to profile the deployment.

---

## 2. Server Actions

Forty files carrying `"use server"`. They are the real API. Every one follows the same four steps, in this order, and a reviewer should treat a deviation as a bug:

1. **Resolve the caller** — `getOrCreateProfile()`. No profile, no write.
2. **Rate-limit** — `checkRateLimit(key, bucket, limit, windowSeconds)`.
3. **Validate** — the arguments, before touching the database.
4. **Write through RLS** — the session-scoped client, never the service-role client, unless the action legitimately writes onto somebody else's row (scoring, notifications, moderation) and says so in a comment.

Actions return `{ error: string | null }` rather than throwing. A thrown error in a Server Action reaches the user as an opaque boundary; a returned one reaches the component that can explain it.

### Rate limit buckets

Real values, from `checkRateLimit` call sites:

| Bucket | Limit | Window |
|---|---|---|
| `create_post` | 5 | 60s |
| `create_comment` | 5 | 60s |
| `set_reaction` | 30 | 60s |
| `vote_on_poll` | 30 | 60s |
| `submit_prediction` | 60 | 60s |
| `submit_fan_rating` | 20 | 60s |
| `toggle_follow` | 20 | 60s |
| `toggle_follow_mute` | 20 | 60s |
| `toggle_save` | 30 | 60s |
| `block_user` | 30 | 60s |
| `search_platform` | 30 | 60s |
| `search_players` / `search_fantasy_players` | 30 | 60s |
| `search_clubs` | 40 | 60s |
| `set_gameweek_roster` | 10 | 60s |
| `join_fantasy_league` | 5 | 60s |
| `create_prediction_league` | 5 | 60s |
| `join_prediction_league` | 10 | 60s |
| `support_request` | 5 | 60s |
| `export_user_data` | 3 | 300s |
| `rename_ai_conversation` | 30 | 60s |
| `delete_ai_conversation` | 20 | 60s |

`submit_prediction` is 60 rather than 20 because migration 0079 turned one prediction per match into six; the per-match budget is unchanged.

Enforced in Postgres (`consume_rate_limit`, migration 0066) rather than in application memory, so the limit survives a serverless instance being replaced mid-minute.

---

## 3. Database functions

The other half of KIVO's API. A `SECURITY DEFINER` Postgres function is how a cross-user aggregate gets computed without opening a table that RLS correctly keeps closed.

The pattern, applied consistently: **a narrow aggregate, never a row**. `get_predictions_leaderboard` returns usernames and summed points, never an individual pick. `get_poll_results_for_posts` returns per-option counts, never a voter. `get_prediction_consensus` returns per-outcome counts, never who chose what.

Grouped by what they exist to do:

- **Atomic multi-table writes**: `upsert_fixture_with_mapping`, `upsert_team_with_mapping`, `upsert_venue_with_mapping`, `vote_on_poll`, `create_templated_poll`, `redeem_invite_code`, `join_public_fantasy_league`, `merge_teams`.
- **Cross-user aggregates**: `get_predictions_leaderboard`, `get_prediction_consensus`, `get_prediction_type_breakdown`, `get_fantasy_league_leaderboard`, `get_prediction_league_leaderboard`, `get_poll_results_for_posts`, `get_motm_poll_result`, `get_fan_rating_summary`, `get_fan_sentiment`, `get_post_engagement`, `get_trending_match_rooms`, `get_trending_posts`, `get_most_followed_teams`, `get_user_head_to_head`.
- **Identity projections**: `get_public_profiles`, `get_public_profile_by_username`, `get_public_profile_stats`, `is_username_available`, `get_my_followers`.
- **Pipeline integrity**: `record_data_anomaly`, `record_entity_alias`, `resolve_football_entities`, `flag_absent_fixtures`, `claim_sync_lock`, `consume_rate_limit`, `prune_rate_limit_events`, `prune_sync_runs`, `notification_payload_is_valid`.

### Grants

Every one of these has its grants stated explicitly rather than inherited. This project's default privileges grant `EXECUTE` on a new public function to `anon`, which has caught this codebase out at least three times (`prune_sync_runs` in 0025, `get_my_followers` in 0050, and the sweep in 0059). Every migration since writes `revoke ... from public; revoke ... from anon; grant ... to authenticated;` in full, and `create or replace` is preferred over drop-and-recreate precisely because it preserves grants.

`record_entity_alias` and `notification_payload_is_valid` are granted to `service_role` only — they are pipeline internals, not user-facing.

---

## 4. Outbound: football providers

KIVO calls providers; providers never call KIVO. There is no webhook endpoint.

The abstraction is `FootballDataProvider` (`src/lib/football/providers/`), with three implementations: API-Football, TheSportsDB, and a development mock. `getFootballDataProvider()` picks one from `FOOTBALL_DATA_PROVIDER`, and every sync path talks to the interface.

**There is no multi-provider failover.** One provider is active at a time. That is a documented trade-off, not an oversight (see `DECISIONS.md`), and the pieces that would need it exist: `provider_mappings` allows several providers per entity, and `provider_disagreement` detection in `upsertFixture` fires the moment a second provider writes a fixture a first one already wrote.

Provider responses are normalized in `src/lib/football/providers/normalizers.ts` before touching the database. A field the provider did not send stays `null` — never `0`, never a guess. That single rule is why KIVO can honestly say "not synced" instead of showing a zero.

### Quota

Real spend is tracked, not estimated. `provider_quota` and the request-budget module bound how much any single sync can consume, and the daily worker floors its own frequency rather than assuming an unlimited plan. See `docs/API_QUOTA.md`.

---

## 5. Outbound: AI

`POST /api/ai/chat` streams from Anthropic. The route is grounded-retrieval-first: it resolves the entities in a question against KIVO's own tables and passes only verified rows into the prompt. The model explains data; it does not supply it.

Fact, calculated insight and uncertainty are separated in the response and rendered as distinct chips. If `ANTHROPIC_API_KEY` is unset, `/ai` says so plainly and every other surface is unaffected — an AI outage cannot take scores, fixtures or social down with it.

---

## 6. What KIVO deliberately does not expose

- **No public REST or GraphQL API.** No third-party consumers exist, and shipping one would mean committing to a contract and a rate-limit story for data KIVO licenses rather than owns.
- **No webhooks in.** Nothing external is trusted to tell KIVO that something happened.
- **No unauthenticated data endpoint.** Since migration 0053, `anon` has essentially no reachable surface (0059 closed the remainder deliberately). `/api/health` is the exception and returns nothing about the data.
- **No client-side provider calls.** A football API key would be readable by anyone who opened devtools.
