# KIVO Recommendations

Generated 2026-08-14 from a full read of the codebase: every root-level `.md`, all ten files under `supabase/migrations/`, and every file under `src/` (all 22 routes under `src/app/(app)/`, the `/admin` tree, all 26 components, the football provider abstraction in `src/lib/football/`, the AI grounding layer in `src/lib/ai/`, `globals.css`, and the Next/ESLint/TS config). No live browser was used, so every UI finding is reasoned from the JSX and Tailwind classes directly.

This document supersedes the earlier competitive-research log that lived at this path (preserved in git at commit `e515a6d`). That log was outside-in market research; this one is inside-out codebase audit. Still-open items from it are folded in and marked where relevant.

Every recommendation here respects the platform's standing rules: zero fabricated football data, $0 provider budget with no cron or polling, Clerk as sole identity authority, RLS-gated Supabase for application data only, and guest-viewable surfaces with sign-up-gated actions. Where an idea brushes against the fabrication line, the honesty constraint is stated explicitly. A handful of ideas are listed specifically as **not buildable** so they stop getting re-proposed.

Sizes: **Small** (under a day), **Medium** (a few days), **Large** (a week or more, or needs a schema plus UI plus pipeline change).

---

## 1. Blocking gaps: features that are built but cannot currently work

These are the highest-leverage findings in the document. Each one is a surface that renders, compiles, and looks finished, but can never leave its empty state because nothing in the codebase writes the data it reads.

1. **Nothing ever sets `seasons.is_current = true`.** `upsertSeason()` in `src/lib/football/sync.ts` inserts with the column's `false` default and never revisits it. Consequences cascade: `/fantasy` filters `seasons.eq("is_current", true)` so league creation permanently shows "No active season yet"; `/teams/[id]` picks `standingsRows.find(s => s.season?.is_current)` so "League position" is permanently empty even after a standings sync. Fix in the sync: mark the newest season per competition current (the unique partial index `idx_seasons_one_current_per_competition` already enforces one per competition). **Small.**

2. **`fantasy_gameweeks` is never inserted anywhere.** Grep confirms only reads (`fantasy/page.tsx`, `fantasy/actions.ts`). Without a gameweek row the squad builder shows "No gameweek is open yet for this season" forever, which means the entire 844-line `fantasy-builder.tsx` is unreachable. Add an admin action that derives gameweeks from real synced fixtures (group a season's fixtures into rounds by `matchday`, or by week when `matchday` is null, deadline = first kickoff of the round). This is derived from real fixture data, not invented. **Medium.**

3. **Predictions are never scored.** `predictions.points_awarded` and `locked_at` are read but never written. `/predictions` correctly refuses to fabricate anything, so the leaderboard is permanently the empty state. Add an admin-triggered scoring pass (same on-demand pattern as the syncs, never cron) that runs over fixtures with `status = 'finished'`, compares `predicted_outcome` to the real result, writes `points_awarded` and `locked_at`, and awards XP via the existing `awardXp` helper. **Medium.**

4. **The predictions leaderboard query is dead by RLS even after scoring lands.** `predictions_select_own` restricts every caller to their own rows, so the cross-user aggregate in `predictions/page.tsx` can only ever see the viewer. This needs a `SECURITY DEFINER` RPC returning `(profile_id, username, total_points)` only, in the same shape as `get_fantasy_league_leaderboard`. Without it, item 3 produces a leaderboard of one. **Small** (migration only).

5. **`fantasy_points` is never written.** Same shape as item 3: the fantasy leaderboard's honest "No gameweeks scored yet" state is permanent. Once gameweeks (item 2) and finished fixtures exist, add an admin-triggered scoring pass over `fantasy_rosters` joined to `fixture_events`, writing `fantasy_points`. Publish the scoring rules in the UI so points are auditable. **Large.**

6. **There is no way for a user to file a report.** `reports` is read in three admin files and written in none. The whole moderation queue, the SLA-aware urgency badges, and `moderation_actions` audit trail can never receive a single item. Add a report affordance on `PostCard` (and later comments/profiles) writing to `reports` under the existing `reports_insert_own` policy. **Small.**

7. **The `comments` table has zero UI.** Full schema, RLS, threading support via `parent_comment_id`, and indexes exist. Not one line of `src/` references it. Ship comment threads on posts. **Medium.**

8. **Match Rooms do not exist.** `posts.fixture_id` exists with an index and the comment "set => match-room post"; the landing page markets "Match Rooms, alive... React to goals in real time, not a comment section bolted on." Nothing in `src/` ever sets or filters on `fixture_id`. Add a Room tab to `MatchCentreTabs` that reads and writes fixture-scoped posts. This is the single biggest gap between what the product claims and what it does. **Medium.**

9. **`fixture_statistics` (migration 0005) is completely dead.** Seventeen real per-team stat columns, RLS policies, an index, and a careful comment about not modelling Sofascore-proprietary metrics. There is no `getFixtureStatistics` on the `FootballDataProvider` interface, no sync, and no UI. Add the provider method against `/fixtures/statistics?fixture=`, wire it into `syncFixtureDetails`, and add a Stats tab to Match Centre. **Medium.**

10. **`notification_preferences` is never read or written.** Eight boolean toggles the settings page doesn't expose. Either ship the preferences UI (item 133) or the table is decoration. **Small.**

11. **`notification_deliveries` has no producer.** There is no delivery pipeline of any kind. Keep it, but mark it explicitly as reserved in `ARCHITECTURE.md` so it does not read as shipped. **Small.**

12. **`profiles.favourite_team_id` can never be set through the product.** It is read once, in `src/lib/ai/grounding.ts`, and written nowhere. This is the anchor for the entire personalization story. Add a team picker (see item 128). **Small.**

13. **`follows` rows are write-only from the user's perspective.** Users can follow teams, players and competitions from three detail pages, but nothing in the app reads follows to change what a user sees. No "your teams" module, no followed-entity feed filter, no following list page. The star button currently does nothing observable. **Medium.**

14. **Five of six `reaction_type` enum values are unreachable.** Only `like` is used in `social/actions.ts`. `fire`, `clap`, `laugh`, `wow`, `sad` exist in the DB and would meaningfully raise expressiveness during a match. **Small.**

15. **`audit_log` is never written.** Moderation writes `moderation_actions`; nothing writes the general-purpose audit table, so admin role changes, data syncs, and user deletions leave no trail. Wire the admin server actions to it or drop the table. **Small.**

16. **`profiles.bio`, `profiles.country` and `profiles.avatar_url` have no editor.** `avatar_url` is synced from Clerk by the webhook and then never rendered anywhere (every avatar in the app is a gradient initial). **Small.**

17. **Fantasy rosters do not carry forward between gameweeks.** `fantasy_rosters` is keyed on `(fantasy_team_id, gameweek_id, player_id)` and `fantasy/page.tsx` loads only the current gameweek. When GW2 opens, the user's squad appears empty and must be rebuilt from scratch. Copy the previous gameweek's roster forward on first load of a new gameweek. **Medium.**

18. **AI conversations are persisted but unreachable.** `ai_conversations` and `ai_messages` accumulate rows with titles derived from the first message, and there is no history list, no resume, no rename, no delete. Refreshing `/ai` starts over. **Medium.**

19. **AI conversation history loads the wrong twenty messages.** `src/app/api/ai/chat/route.ts` does `.order("created_at", { ascending: true }).limit(MAX_HISTORY_MESSAGES)`, which returns the *oldest* twenty messages. Past message twenty, the model stops seeing anything recent. Order descending, take twenty, then reverse. **Small, and a real bug.**

20. **Guests see no author names on the social feed.** `posts_select_public` grants `anon` read on posts, but `profiles` has no `anon` SELECT policy at all, so the embedded `author:profiles(...)` join returns null for signed-out visitors and every post renders as "KIVO fan". Same problem on the predictions leaderboard join. Fix with a narrow public view or an `anon` policy exposing only `username`, `display_name`, `avatar_url`. **Small, and a real bug on the platform's most public surface.**

---

## 2. Backend, schema and data model

21. **Add a `public_profiles` view (or narrow `anon` SELECT policy) and route every public-facing author join through it.** Fixes item 20 without loosening `profiles_select_own_or_admin`. Expose `id`, `username`, `display_name`, `avatar_url` and nothing else. **Small.**

22. **Sync writes are not transactional.** In `sync.ts`, a `fixtures` insert can succeed and its subsequent `provider_mappings` insert can fail, leaving an orphan fixture that the next sync will duplicate because `findMappedId` returns null. Wrap each entity's insert-plus-mapping in a `SECURITY DEFINER` RPC so both land or neither does. **Medium.**

23. **`upsertCompetition`, `upsertTeam` and `upsertVenue` never update.** They return early on an existing mapping, so a renamed club or a new crest URL is ignored forever. Update the row on every sync, using the same "never clobber with null" rule `sync-squads.ts` already applies to players. **Small.**

24. **`upsertVenue` writes `"Unknown venue"` placeholder rows** when the provider gives an id but no name. That is a fabricated string in a public table. Leave `venues.name` nullable, or skip creating the venue entirely. **Small.**

25. **`toDbFixtureStatus` maps `"unknown"` to `"postponed"`.** That asserts a factual match state the provider never reported. Add `unknown` to the `fixture_status` enum, or leave the fixture at its previous status and log the unmapped code. **Small.**

26. **`sync_runs.entity_type` is misused for two run types.** Lineups plus events runs are recorded as `fixture_event`, and standings runs as `season`, both with apologetic code comments. The Data Health screen therefore mislabels its own history. Add `lineup` and `standing` to the `provider_entity_type` enum. **Small.**

27. **The sync loop makes roughly six sequential round trips per fixture** (competition lookup, season select, two team lookups, venue, fixture upsert, plus mapping inserts). An unfiltered `/fixtures?date=` day returns hundreds of fixtures worldwide, so one "Sync now" click is easily 1500+ sequential Supabase calls in a single server action. Expect timeouts. Batch the lookups (one `in()` query for all provider ids up front), then bulk upsert. **Medium.**

28. **Scope `getFixturesByDate` to specific competitions.** Carried forward from the prior log and still open. API-Football supports `league=`, and the free tier's real constraint is request count, not response size, so scoping costs nothing and stops KIVO's `teams`/`competitions`/`venues` tables filling with leagues the product does not cover. **Small.** **Status: DONE (2026-08-15).** Config-driven via `FOOTBALL_SYNC_COMPETITION_IDS` (new, see `ENVIRONMENT.md`) — `src/lib/football/competitions-config.ts`'s `getSyncedCompetitionProviderIds()`, applied in `syncTodayFixtures` by filtering the already-fetched day's response (not one provider request per league — costs zero extra quota either way, per this item's own reasoning) before any competition/team/venue/fixture is written. Deliberately filters the response rather than calling `league=` per configured id: a single admin-triggered sync still costs exactly one provider request regardless of how many competitions are configured. Unset (the default) means no filter — this codebase has no existing "which leagues does KIVO cover" product decision recorded anywhere to hardcode as a default, so defaulting to a filtered set would be an invented assumption, not a real one; the admin-triggered sync flow is unchanged until an operator actually sets the var.

29. **The four sync files each redefine `findMappedId`, `createMapping`, `findProviderEntityId` and `upsertTeam`.** The duplication is documented as deliberate under an earlier file-scope constraint that no longer applies. Extract to `src/lib/football/provider-mappings.ts`. Four copies of the dedupe logic is four places for drift. **Small.**

30. **Season identity is inconsistent with the schema's own documentation.** `seasons.name` is commented as `"2025/2026"` but `upsertSeason` writes the bare provider year (`"2025"`), and `syncStandings` then does `Number(season.name)` to get back to it. Pick one representation and store the provider year in a dedicated integer column. **Small.**

31. **Add `pg_trgm` GIN indexes for the three `ilike '%...%'` searches** on `teams.name`, `players.full_name`/`known_as`, and `competitions.name`. The existing btree indexes cannot serve a leading-wildcard match, so the command palette and fantasy player picker do sequential scans. **Small.**

32. **Index `transfers.from_team_id` and `transfers.to_team_id`.** Migration 0006 indexes only `player_id` and `transfer_date`, but the player page and any future club transfer ledger join on both team FKs. **Small.**

33. **Add a partial index for the Live page:** `create index on fixtures (kickoff_at) where status in ('live','halftime')`. The `/live` query filters on exactly that. **Small.**

34. **Add `reports (status, created_at)`** to serve the moderation queue's oldest-first filter on open statuses. **Small.**

35. **Add `standings (season_id, position)`** for the ordered table reads on `/leagues/[id]` and Match Centre. **Small.**

36. **Replace the client-side XP sum with an RPC.** Both `/home` and `/rewards` pull every `xp_ledger` row and reduce in JavaScript. A `get_xp_total()` `SECURITY DEFINER` function returning a single integer is one round trip and scales. **Small.**

37. **Replace the two-step social feed aggregate with one RPC or view.** `social/page.tsx` fetches 50 posts, then fetches every `like` reaction for those 50 ids, then builds a Map. A `posts_with_like_counts` view (or an RPC taking the viewer's profile id) returns count plus `liked_by_viewer` in one query. **Small.**

38. **Tighten the `notifications_update_own` policy.** The migration itself flags that RLS is row-scoped, so a user can rewrite their own notification's `payload` and `type`. Drop the UPDATE policy and expose a `mark_notifications_read(uuid[])` RPC instead. **Small.**

39. **Escape user input before building `ilike` patterns.** `searchPlatform` and `searchFantasyPlayers` interpolate raw query text into `%${q}%`. A user typing `%` or `_` gets wildcard semantics, and a string of `%` characters is a cheap way to force expensive scans. Escape `%`, `_` and `\`. **Small.**

40. **Validate route params as UUIDs before interpolating them into PostgREST filters.** `teams/[id]/page.tsx` builds `.or(\`home_team_id.eq.${id},away_team_id.eq.${id}\`)` directly from the URL segment. Even though a malformed value will error rather than leak, unvalidated input inside a filter-expression string is the wrong default. Add a shared `parseUuidParam()` that calls `notFound()` on a bad shape. **Small.**

41. **`redeem_invite_code` returns raw Postgres error text to the client.** `joinFantasyLeague` passes `error.message` straight through. That is correct for the function's own `raise exception` messages but leaks internals for any other failure (constraint violations, type errors). Match on a known set and fall back to a generic message otherwise. **Small.**

42. **Six-character invite codes have no redemption throttle.** The alphabet is 32 characters and the code is 6, so the space is about 1e9, which is fine against a single attacker but not against an unthrottled server action. Add per-user attempt limiting inside the RPC. **Small.**

43. **Public fantasy leagues cannot be discovered.** `fantasy_leagues.is_private` exists and the UI offers a Private/Public toggle, but there is no browse-public-leagues surface and `redeem_invite_code` requires a code regardless. Either ship discovery for public leagues or remove the toggle rather than shipping a switch that changes nothing. **Medium.**

44. **`follows.followed_id` is polymorphic with no FK and no cleanup.** Deleting a team leaves dangling follow rows that will render as broken links once a followed-entities page exists (item 13). Add a cleanup trigger or a periodic admin-triggered reconciliation. **Small.**

45. **Moderator post deletion is a hard delete.** `posts_delete_own_or_moderator` removes the row, but `moderation_actions.target_id` then points at nothing, so the audit trail records a decision with no recoverable evidence. Add a content snapshot column on `reports` captured at report time, or soft-delete posts with a `deleted_at`. **Medium.**

46. **The moderation queue shows no reported content.** `ReportRow` renders target type, reporter and reason, with no way to see the post being judged. Moderators are asked to decide blind. Resolve the polymorphic target server-side and render a preview. **Medium.**

47. **`predictions.fixture_id` cascades on fixture delete.** If a fixture is ever removed or re-synced under a new id, users silently lose prediction history and any awarded XP becomes unexplainable. Consider `on delete restrict` plus an explicit admin flow. **Small.**

48. **Add a sync retention policy.** `sync_runs` grows without bound and its `error_message` can hold twenty concatenated failures. Prune runs older than ninety days from an admin action. **Small.**

49. **Migration 0001's header still says "DRAFT MIGRATION (NOT APPLIED)"** despite nine follow-on migrations building on it. Correct the header so nobody treats the base schema as hypothetical. **Small.**

50. **No migration carries rollback notes.** For a schema this heavily commented, a one-line "to reverse" note per migration is cheap and would matter during an incident. **Small.**

---

## 3. Football data pipeline and free-tier strategy

51. **`FOOTBALL_LIVE_POLLING_ENABLED` is exported from `src/lib/football/index.ts` and read by nothing.** The flag is the documented safety valve for the entire live strategy but currently guards no code path. Either use it to gate a manual "refresh live scores" action or document it as reserved. **Small.**

52. **Cache windows live in the provider, but there is no request budget tracker.** The free tier is 100 requests per day; `syncFixtureDetails` alone makes two provider calls plus a potential squad sync per side, and an admin clicking "Sync match details" on six matches can exhaust a third of the daily budget without any visible counter. Record provider call counts on `sync_runs` and surface a daily total on Data Health. **Medium.**

53. **API-Football returns its own remaining-quota headers on every response.** `ApiFootballProvider.request()` discards them. Read `x-ratelimit-requests-remaining` and persist it so Data Health can show real remaining quota instead of an estimate. This is real provider data, not a guess. **Small.**

54. **`request()` treats every non-OK response identically.** A 429 (rate limited), a 403 (bad key) and a 500 both surface as "API-Football request failed". Distinguish them so the admin sees "daily quota exhausted" rather than a generic failure. **Small.**

55. **No retry or backoff on transient provider failures.** A single network blip fails an entire sync run. Add one retry with jitter for 5xx and network errors only, never for 429. **Small.**

56. **`getSquad` discards the player photo.** API-Football's squads response includes `photo`, which is real provider data already being fetched and paid for in quota. Add `photo_url` to `players` and render it: player pages currently show a generic silhouette for everyone. **Small.**

57. **Fixture minute is fetched and thrown away.** `NormalizedFixture.minute` is populated by the provider and never written, because `fixtures` has no minute column. The Live page therefore cannot show "67'" on a live match, which is the single most-wanted number on a live scores screen. Add `fixtures.minute_elapsed`. **Small.**

58. **Half-time scores are modelled but never synced.** `fixtures.home_score_ht`/`away_score_ht` exist; the provider adapter does not map them. **Small.**

59. **`ensureTeamHasSquad` can silently blow the daily quota.** Inside `processLineupSide`, a first-time fixture-details sync triggers a full squad sync per side, each of which makes two more provider calls. Syncing details for five fixtures across ten unseen teams is 20+ unplanned requests. Make the auto-squad-sync opt-in and tell the admin what it will cost. **Small.**

60. **Add a "sync this fixture" affordance on the public Match Centre for admins only** (the pattern already exists via `InlineSyncButton`), plus a visible "last synced" timestamp on every football surface. `retrievedAt` is carried on `NormalizedFixture` specifically for freshness display and is currently dropped at the sync boundary. **Small.**

61. **Standings sync requires a season with a provider-mapped competition and a numeric name,** both of which depend on a prior fixture sync. That dependency chain (fixtures then squads then transfers; fixtures then standings) is only discoverable by reading error strings. Document it on the Data Health page as an ordered checklist. **Small.**

62. **No provider fallback.** The abstraction exists precisely to allow one, but `getFootballDataProvider()` returns a single cached instance and throws in production without a key. When quota runs out mid-day, every football surface degrades to empty with no explanation. At minimum, catch quota exhaustion and render "today's data is capped until tomorrow" rather than "nothing synced". **Small.**

63. **The mock provider ships in the production bundle** even though it throws at selection time. It is a server-only module so the risk is size, not correctness, but a `NODE_ENV` guarded dynamic import keeps it out. **Small.**

64. **Transfers accumulate unresolved clubs with no backfill.** `resolveTeamId` correctly nulls a team KIVO has not seen, but nothing ever revisits those rows once the club does get synced, so "Club not synced" is permanent. Add a reconciliation pass keyed on `provider_mappings`. **Small.**

65. **Consider persisting the raw provider response** (or a hash of it) alongside each `sync_runs` row for a bounded window. When a normalizer misclassifies an event type, there is currently no way to diagnose it without spending fresh quota. **Small.** **Status: DONE (2026-08-15).** Migration `0041_sync_run_raw_response_sample.sql` adds nullable `sync_runs.raw_response_sample jsonb`, bounded by a check constraint (~21,000 chars) as defense in depth on top of the app-layer cap. `FootballDataProvider` gained `getLastRawResponseSample()` (see `src/lib/football/raw-response-sample.ts` for the shared `buildRawResponseSample()` truncation helper), implemented in both `ApiFootballProvider` and `TheSportsDbProvider` (honestly `status: null` on TheSportsDB's success path — its `requestWithRetry` doesn't surface the Response object back to the caller, only the parsed body) and honestly `null` in `MockFootballProvider` (no real upstream to sample). `syncTodayFixtures` writes it on both the hard-failure path and the normal finish path, so it's available "on request" for a run that otherwise succeeded, not only after a failure.

---

## 4. Frontend architecture

66. **Extract `TeamCrest`.** It is redefined in eight files (`home/page.tsx`, `matches/page.tsx`, `matches/[id]/page.tsx`, `teams/[id]/page.tsx`, `players/[id]/page.tsx`, `transfers/page.tsx`, `live/page.tsx`, `prediction-card.tsx`, `fantasy-builder.tsx`) with subtly different sizes, fallbacks and alt-text handling. One `components/football/team-crest.tsx` with a `size` prop. **Small.**

67. **Extract fixture status presentation.** `STATUS_LABEL`, `isLiveStatus`, `formatKickoff` and `statusBadgeText` are copy-pasted across `matches/page.tsx`, `matches/[id]/page.tsx`, `live/page.tsx` and `teams/[id]/page.tsx`. Move to `src/lib/football/fixture-status.ts` and add a `<FixtureStatusBadge>` component, since the live-pulse pill markup is duplicated four times too. **Small.**

68. **Deduplicate `positionGroup`.** It exists in `teams/[id]/page.tsx` and `fantasy/fantasy-rules.ts` with different group arrays (the team page includes "Other" as a display group, fantasy treats it as invalid). Two heuristics for the same free-text field will drift. **Small.**

69. **Deduplicate `timeAgo`** (`post-card.tsx`, `notification-bell.tsx`), **`calculateAge`** (`teams/[id]`, `players/[id]`) and the three `formatDate` variants. Put them in `src/lib/format.ts`. **Small.**

70. **Extract a shared entity-list page pattern.** `/teams`, `/players` and `/leagues` are structurally identical: fetch, branch to `ComingSoon` when empty, render a `FadeIn`-staggered list. A `<StaggeredList>` plus a shared header removes three near-copies and makes adding `/managers` and `/venues` trivial. **Small.**

71. **Replace the `NAV_ITEMS.find(...)!` non-null assertion** used in eight page modules with a `getNavItem(id)` helper that throws a named error at module load. A typo currently produces a runtime `undefined` crash on `item.icon`. **Small.**

72. **Stop using `ComingSoon` for "data not synced yet".** Teams, Players, Leagues, Matches, Live, Predictions, Transfers and Discover all render the full-page "Coming soon" treatment when their tables are empty. The feature is built; the data is not there. Showing "Coming soon" on a shipped feature is both confusing and, in spirit, a small dishonesty about what exists. Introduce a distinct `<NoDataYet>` state with different copy and visual weight. **Small.**

73. **Make the landing page a Server Component.** `src/app/page.tsx` is entirely `"use client"` so that a `motion.div` can float the logo. That ships React, `motion`, and the whole page tree as client JS on the highest-traffic, most bounce-sensitive route. Move the animation into a small client child or replace it with a CSS keyframe (the codebase already uses that pattern in `globals.css`, `transfers/page.tsx` and `rewards/page.tsx`). **Small.**

74. **`MotionConfig` is nested three deep.** Root layout wraps everything, `AppShell` wraps again, `admin/layout.tsx` wraps again. One at the root is enough. **Small.**

75. **`PageTransition` adds an exit delay to every navigation.** `AnimatePresence mode="wait"` holds the new route until the old one finishes its 180ms exit, and that is additive to the RSC round trip on every link click. On a variable mobile connection (an explicit design constraint for the Nigeria-first launch) this reads as sluggishness, not polish. Make it enter-only, or drop it. **Small.**

76. **`FadeIn` renders server content at `opacity: 0` until hydration.** Every page's above-the-fold content is invisible until the JS bundle loads and `motion` mounts. If hydration fails or is slow, the user sees a blank screen with a working nav. Use a CSS entrance animation for first paint and reserve `motion` for interaction. **Medium** (touches most pages, but mechanical).

77. **Cap list-stagger delays.** `delay={Math.min(index * 0.03, 0.3)}` means the last visible row of a long list appears 300ms after the first on every navigation. Cap at the first four to six items and render the rest immediately. **Small.**

78. **Wrap `getOrCreateProfile()` in React `cache()`.** It is called in `(app)/layout.tsx` and again in nearly every page, so a single request does `currentUser()` plus a `profiles` SELECT two to four times. `cache()` collapses it to one. Same for `createServerSupabaseClient()`, which is instantiated two or three times per page. **Small, high impact on every server render.**

79. **Suspend the notification fetch in `TopBar`.** `await getRecentNotifications()` blocks the app shell from painting on every single page. Move it behind `<Suspense>` so the nav renders immediately. **Small.**

80. **Reconsider `export const dynamic = "force-dynamic"` on the whole `(app)` group.** Public, non-personalized surfaces (`/teams`, `/players`, `/leagues`, `/matches`, `/transfers`) are forced dynamic solely because the shell resolves a profile. Push the dynamic boundary down to the per-user components so the football pages can be cached and revalidated by the sync actions that already call `revalidatePath`. **Medium.**

81. **Scope the over-broad revalidations.** `follow-actions.ts` and `notifications/actions.ts` both call `revalidatePath("/", "layout")`, which throws away the entire app's cache to record one like or one follow. Revalidate the specific paths. **Small.**

82. **Split `fantasy-builder.tsx`.** 844 lines holding `FantasyBuilder`, `StatTile`, `PitchLines`, `PlayerToken`, `PlayerActionSheet`, `ActionRow` and `PlayerPicker`. Split into `pitch.tsx`, `player-picker.tsx` and `player-action-sheet.tsx`. **Small.**

83. **`useNow(30_000)` re-renders the entire fantasy builder every thirty seconds** just to update a countdown string. Move the ticking into a `<DeadlineCountdown>` leaf. **Small.**

84. **`searchFantasyPlayers` applies the position filter after `.limit(60)`.** The query fetches the first 60 players alphabetically and *then* filters to, say, Goalkeepers, so filtering by position returns whatever goalkeepers happen to fall in the first 60 names. This is a real correctness bug that makes the picker unusable at any real squad size. Push position filtering into the query (add a `position_group` generated column or filter with `or(...ilike)`). **Small.**

85. **Neither debounced search cancels in-flight requests.** `command-palette.tsx` and `PlayerPicker` both debounce then fire a server action, with no abort, so a slow earlier response can overwrite a faster later one. Track a request sequence number and discard stale results. **Small.**

86. **Remote crest images have no `sizes` attribute** and go through the Next image optimizer at 16-40px. For tiny remote logos, `unoptimized` (or a `sizes` hint) avoids a per-URL optimization round trip on first render of every new club. **Small.**

87. **The KIVO logo is a raster PNG imported in five components.** `ICON_MANIFEST.md` already records that no clean-alpha or vector source exists. Requesting an SVG (carried forward from the prior log, item 23) remains the right ask, and would remove the largest single asset from the shell. **Small** (once the source exists).

88. **155 icons ship in `public/assets/`; eleven are referenced.** That is roughly 144 unused files in the deployed bundle. Either prune to what is used with a documented archive, or note in `ICON_MANIFEST.md` that the full set ships deliberately as a design library. **Small.**

---

## 5. Loading, error and edge-case states

89. **Only three routes have a `loading.tsx`** (`/admin`, `/social`, `/home`). Every other route, including all four `[id]` detail pages that each fire five or more queries, shows nothing during navigation. Add skeletons for `/matches`, `/teams`, `/players`, `/leagues`, `/transfers`, `/predictions`, `/fantasy`, `/live`, `/discover` and the detail routes. **Small each, Medium in total.**

90. **There is no `error.tsx` anywhere and no `global-error.tsx`.** A Supabase outage, a malformed row, or any thrown error in a server component drops the user onto Next's unstyled default error page, outside the brand and with no retry. Add one at the `(app)` group root and one at `/admin`. **Small.**

91. **There is no `not-found.tsx` inside `(app)`.** The four detail pages call `notFound()`, which renders the root-level 404 outside the app shell, so a mistyped team id ejects the user from the navigation entirely. **Small.**

92. **The 404 page has no way forward except "Back to Home".** Add the search entry point and links to Matches and Social. **Small.**

93. **No `generateMetadata` on any dynamic route.** `/teams/[id]`, `/players/[id]`, `/leagues/[id]` and `/matches/[id]` all inherit the root title, so every shared link reads "KIVO: Football. Together. Live." with the same generic description. For a product whose growth loop is fans sharing match links, this is the cheapest high-impact fix available. **Small.**

94. **No `opengraph-image`, no Twitter card metadata.** Same growth-loop argument. A static branded OG image is a single file; a dynamic one per fixture (using only real synced team names and the real score) is a strong second step. **Small to Medium.**

95. **No `sitemap.ts` and no `robots.ts`.** Every entity page is guest-viewable and therefore indexable, and none of them are discoverable by a crawler. **Small.**

96. **No `manifest.ts`, no PWA icons, no `theme-color`.** The product is explicitly mobile-first with a safe-area-aware bottom nav, and cannot be installed to a home screen. **Small.**

97. **No `viewport` export,** so iOS Safari's chrome does not match the obsidian background. **Small.**

98. **Loading feedback is text-only in most action flows** ("Saving…", "Syncing…", "Posting…", "Searching…"). The picker, leaderboard, standings and AI response areas would all read as faster with skeletons. **Small.**

99. **`InlineSyncButton` tells the user "Refresh to see it"** after a successful sync. The server action already calls `revalidatePath`; wire the button to `router.refresh()` so the data appears. Asking the user to refresh manually is a visible seam. **Small.**

100. **No offline or connection-failure state.** Only the AI chat has a "check your connection" message. Given the launch market, a global offline banner backed by `navigator.onLine` is worth the small cost. **Small.**

---

## 6. UX and product flow

101. **The guest post composer blurs the textarea on focus.** `post-composer.tsx` calls `e.currentTarget.blur()` for signed-out users, so a guest who taps the box gets the cursor yanked away with no explanation, and a keyboard user gets a focus trap. Replace with a non-interactive card whose whole surface is a "Sign up to post" link. **Small.**

102. **Sign-in and sign-up never carry a return destination.** Every gated action (`PostCard` like, `PredictionCard` pick, `AiChat` send, composer submit) does `router.push("/sign-up")` with no redirect param, so a user who wanted to like one post is dumped on `/home` afterwards and has to find their way back. Pass `forceRedirectUrl` through. This is the single largest leak in the guest-to-signed-up funnel. **Small.**

103. **The landing page's primary CTA does not convert.** "Get started" links to `/home`, which is fully guest-viewable, so the button starts nothing. Point it at `/sign-up` and keep a secondary "Look around first" pointing at `/home`. **Small.**

104. **Sign-up copy is inconsistent across five surfaces:** "Join KIVO", "Sign up", "Sign up to post", "Get started", "Sign up to start earning XP and badges". Pick one primary verb and one benefit clause. **Small.**

105. **Landing copy overstates what runs today.** "Scores, events and match intelligence that update the moment they happen. No refresh, no lag" describes live polling that is deliberately disabled and, per `DECISIONS.md`, will stay disabled on the free tier. The rest of the platform is scrupulous about honest states; the front door should match. Reframe as what KIVO is building toward, or describe the on-demand model plainly. **Small.**

106. **Onboarding asks for a username and nothing else.** The one question that would make Home, Discover, the AI Copilot and notifications feel personal is "which club do you support", and the column already exists. Add it as an optional second step, shown only when teams are actually synced so it never presents an empty picker. **Small.**

107. **"Skip for now" awards the same 10 XP and the same "Welcome to KIVO" badge as completing onboarding,** whose description reads "Completed onboarding and picked a KIVO handle". Skipping does neither. Either award nothing on skip or reword the badge. **Small.**

108. **No username availability check before submit.** Both `completeOnboarding` and `updateUsername` only discover a collision from a `23505` after a full round trip. A debounced check against the same server action pattern already used elsewhere would fix it. **Small.**

109. **`/matches` cannot show any day but today.** No date picker, no yesterday, no tomorrow, no competition grouping. A page called "Matches" that structurally cannot show tomorrow's fixtures is a product gap, not a data gap: the fixtures table holds whatever has been synced. Add a date strip. **Medium.**

110. **`/matches` cards are not links to the Match Centre.** Only the two team names link (to team pages). Home's `FixtureRow` links the whole row to `/matches/[id]`, and `/live` links its whole card, so Matches is the odd one out and the primary tap target is missing. **Small.**

111. **`/players` shows the first 100 players alphabetically with no search, filter or pagination.** After one real squad sync of a handful of clubs, most players are unreachable from this page. Add search and position/club filters (the command palette already proves the query shape). **Small.**

112. **`/teams` and `/leagues` have no `limit` at all.** Both will render every synced row into one DOM node. Paginate or virtualize before the first broad sync. **Small.**

113. **`/transfers` has no filters** (club, type, date range) and a hard `limit(50)`. **Small.**

114. **The prediction flow gives no confirmation moment.** Picking an outcome fills a pill and nothing else happens. `UsernameEditor` already has the right pattern (a transient "Saved" check). Predictions are the higher-stakes action and have less feedback. **Small.**

115. **Prediction cards show no countdown to kickoff and no near-lock warning.** The action is time-limited and the deadline is invisible until the submission is rejected. `formatDeadlineCountdown` already exists in `fantasy-rules.ts`. **Small.**

116. **There is no "my predictions" view.** Users can submit but cannot see their history, their record, or which of their picks are still live. **Medium.**

117. **The like button surfaces no error.** `PostCard` reverts silently on failure, so a user on a flaky connection sees their like undo itself with no explanation. **Small.**

118. **The like revert restores the wrong count.** On failure it calls `setOptimisticCount(likeCount)`, resetting to the server-rendered prop rather than the pre-click optimistic value, so after two rapid interactions the count can visibly jump to a stale number. **Small.**

119. **The social feed has no pagination and no "new posts" affordance.** A server-rendered `limit(50)` goes stale the moment it paints, and there is no way to load older posts. **Medium.** Pagination shipped an earlier pass (`SocialFeed`'s "Load more"). **Status: "New posts" affordance DONE (2026-08-15).** Migration `0042_realtime_posts.sql` adds `posts` to the `supabase_realtime` publication (it was already public-select, so this widens no read access — same reasoning as migration 0038's fixtures/fixture_events). `SocialFeed` subscribes to real `postgres_changes` INSERT events (not a poll) and shows a dismissible "New posts" pill — reusing `loadMorePosts(0, ...)` to reload from the top on click rather than merging the bare realtime payload directly, since an INSERT event doesn't carry the reaction/comment/poll joins a real post card needs. Never auto-inserts a new post into the visible list, per the standing instruction not to jump content under a reader's cursor. On the "Following" tab, the client reads the viewer's own real `follows` rows once (via `follows_select_own`) to decide whether an incoming post is relevant, mirroring `fetchPostsPage`'s server-side filter.

120. **Post bodies render as raw `whitespace-pre-wrap` text.** No link detection, no mention linking, no line clamp with "show more" for a 2000-character post. **Small.**

121. **`timeAgo` has no upper bound.** A year-old post reads "412d". Switch to a date past thirty days. **Small.**

122. **Notifications are not clickable through to their target.** `payload.post_id` is stored by `notifyPostLiked` and never used, so tapping a notification only marks it read. **Small.**

123. **`describe()` in `notification-bell.tsx` handles exactly one type** and falls back to `type.replace(/_/g, " ")`, which will show users raw snake-case strings as new notification types ship. Build a typed registry with a title, icon and href per type. **Small.**

124. **Every notification renders a Heart icon** regardless of type, which will be actively wrong for match alerts, fantasy deadlines and moderation outcomes. **Small.**

125. **There is no `/notifications` page,** only `app/notifications/actions.ts`. The bell caps at twenty with no "see all". **Small.**

126. **The unread badge is only correct on full page load.** No polling, no revalidation on focus. A visible-but-stale count is worse than none. Revalidate on window focus. **Small.**

127. **The `⌘K` hint is shown to every platform,** including Windows and Linux where the palette listens for Ctrl+K. Detect the platform. **Small.**

128. **The command palette has no recent searches and no zero-state suggestions.** With an empty database it says "Type at least 2 characters" and then "No matches", giving a new user two dead ends in a row. **Small.**

129. **`FollowButton` renders only for signed-in users,** so guests see no follow affordance at all, breaking the guest-CTA pattern that `PostCard` and `PredictionCard` follow. Render it for guests and route to sign-up on tap. **Small.**

130. **Following gives no confirmation and leads nowhere.** A star fills in, and there is no toast, no count, and no page listing what you follow. **Small** (pairs with item 13).

131. **The mobile bottom bar puts Matches and Predictions behind "More"** while Fantasy (currently unreachable, per items 1 and 2) sits in the primary four. Re-evaluate against the four destinations users actually need on matchday. **Small.**

132. **The "More" sheet is a 4-column grid of twelve items** with 11px labels in roughly 80px cells on a 360px screen. Two columns with icon-plus-label rows would be far more legible. **Small.**

133. **The desktop sidebar lists sixteen items flat.** Group them (Watch / Play / You) so the eye can find things. **Small.**

134. **There is no link to `/admin` anywhere in the app shell.** Admins must type the URL. Show it in the sidebar when `hasAdminAccess(profile.role)`. **Small.**

135. **Settings exposes only email, username and sign-out.** Missing: notification preferences (item 10), country, bio, avatar, delete account, and data export. Account deletion in particular is a legal expectation and the schema comment already anticipates it as a server-side flow. **Medium.**

136. **`/profile` is a stub** with placeholder copy about what will live there, and `UsernameEditor` is duplicated on both `/profile` and `/settings` with identical behaviour. Consolidate, and give `/profile` real content: XP, badges, follows, prediction record. **Medium.**

137. **There is no public profile route.** Usernames are the social identity across the feed and the fantasy leaderboard, and clicking one goes nowhere. `/u/[username]` backed by the public profile view from item 21. **Medium.**

138. **`/rewards` has no XP history.** `xp_ledger.reason` stores a human-readable reason for every entry and it is never shown. A simple list of "+10 Completed onboarding" is more motivating than a single total. **Small.**

139. **Badges show no progress toward the next one.** Two badges exist, both binary. Add the criteria to each locked badge card. **Small.**

140. **The badge catalogue is two entries.** With predictions, fantasy, follows and streaks all real and measurable, this is the cheapest engagement surface in the product. Add badges only for things genuinely tracked. **Small.**

141. **XP is farmable.** `createPost` awards 2 XP per post with no cooldown and no minimum quality bar. Add a daily cap. **Small.**

142. **The Discover page's "transfers synced" count is technically true but misleading:** transfers only exist for players an admin has individually synced, so the number reflects admin activity rather than transfer activity. Say so in the card copy. **Small.**

---

## 7. Accessibility

143. **Both tab groups lack ARIA semantics.** `MatchCentreTabs` and the fantasy Squad/Leaderboard switcher are plain `<button>`s with no `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected` or arrow-key navigation. Screen reader users get three unlabeled buttons. **Small.**

144. **Match Centre's active tab is not in the URL.** It cannot be shared, bookmarked, or survive a refresh, and the browser back button does not undo a tab change. Use a search param. **Small.**

145. **The command palette has no combobox semantics.** No `role="listbox"`, no `role="option"`, no `aria-activedescendant`, so keyboard arrow navigation moves a visual highlight that assistive tech cannot see. **Small.**

146. **The keyboard-active palette result is never scrolled into view.** Arrowing past the fifth result in a `max-h-80` container moves the selection off-screen. **Small.**

147. **The notification panel declares `role="dialog"` with no focus trap and no focus return.** `MobileBottomNav` implements a proper trap and could be the shared reference. **Small.**

148. **`PlayerActionSheet` and `PlayerPicker` declare `role="dialog" aria-modal="true"` with no focus trap, no Escape handler, and (for the action sheet) no `aria-label`.** `aria-modal` without a trap is an active lie to assistive tech, which is exactly the reasoning already written into `mobile-bottom-nav.tsx`. Extract that trap into a shared `useFocusTrap` hook and apply it to all four dialogs. **Small.**

149. **Full-screen backdrop `<button aria-label="Close">` elements** are announced before the dialog content in three sheets. Use a non-focusable div with a click handler plus an explicit close button. **Small.**

150. **Standings render as CSS grids of `<span>`s,** not tables, so they carry no row or column relationships. The admin users table gets this right with real `<th>`. Use a real `<table>` with `scope` attributes. **Small.**

151. **Match result colour is the only encoding of win/loss.** `teams/[id]` colours a scoreline green or red with no accompanying W/L text, which fails for colour-blind users. **Small.**

152. **`text-[9px]` and `text-[10px]` appear throughout** (nav labels, badge chips, standings headers, stat captions). Below roughly 12px, legibility drops sharply on real phone screens. Raise the floor. **Small.**

153. **`html { font-size: 17px }` in `globals.css` overrides the user's browser base font size.** Anyone who has increased their default text size gets it silently ignored, which is a WCAG 1.4.4 problem. Use `font-size: 106.25%` (or bump the Tailwind type scale) to keep the intended visual size while respecting user preference. **Small.**

154. **No `color-scheme: dark` declaration.** Native controls, including the `<select>` in the fantasy create-league card, render with light chrome on a dark page. The `className="bg-kivo-navy"` on `<option>` elements is ignored by most browsers, so that dropdown is likely white-on-white somewhere. **Small.**

155. **The reduced-motion block clamps `transition-duration` globally with `!important`,** which also kills useful non-motion transitions like colour and opacity changes on hover and focus. Narrow the rule to `animation` and transform-based transitions. **Small.**

156. **Focus rings are inconsistent.** Present on nav links, palette results, `PostCard`'s like button and `FollowButton`; absent on `MatchCentreTabs`, the fantasy view tabs, `PlayerToken`, `ActionRow`, `InlineSyncButton`, `FootballSyncButton` and the report row buttons. **Small.**

157. **No `aria-live` on async result regions:** AI chat messages, prediction errors, post errors and the fantasy save bar all appear silently. The sync buttons get this right with `role="status"`. **Small.**

158. **Pending buttons set only `disabled` and an opacity change,** with no `aria-busy`. **Small.**

159. **`.kivo-glass:hover` applies a background change to non-interactive cards,** so static containers (fixture list items, stat panels) signal clickability they do not have. Scope the hover to an opt-in class. **Small.**

---

## 8. New features, real data only

Each of these is backed by data KIVO already has or can obtain within the existing provider abstraction and free-tier budget. The data source is named for each.

160. **Team form guide (last five results).** Derived entirely from `fixtures` rows already fetched by `/teams/[id]`, which currently queries the last ten finished matches and shows them as a list without the at-a-glance W/D/L strip every competitor has. Zero new queries, zero new quota. **Small.**

161. **Head to head.** Real: query `fixtures` for prior meetings between two teams and show the record. Appears on Match Centre and on team pages. Honest fallback when KIVO has fewer than N synced meetings: say exactly how many it has. **Small.**

162. **Goal-timing distribution.** `fixture_events.minute` is already stored for every synced goal. "This club has scored 6 of its 11 goals after the 70th minute" is a genuinely interesting, entirely real stat, computed from data already in the database, and it must be labelled with the number of matches it is drawn from. **Small.**

163. **Discipline table.** Cards per team and per player from `fixture_events`. Same honesty label. **Small.**

164. **Club transfer ledger.** All transfers in and out for a club, from the `transfers` table joined on `from_team_id`/`to_team_id`. No extra provider calls, and it makes the transfers already synced far more useful. **Small.**

165. **Manager pages.** `managers` rows are synced by `syncTeamSquad` and have no page, no list, and no link. A `/managers` list and `/managers/[id]` detail (name, nationality, current club, that club's form) costs one route and zero quota. **Small.**

166. **Venue pages.** Same argument: `venues` is populated by every fixture sync and surfaces only as a line of text on a team page. Fixtures played there, capacity, city. **Small.**

167. **Player comparison.** Two players side by side on appearances, starts, goals and cards, all from `lineups` and `fixture_events`. Must carry an explicit "based on N matches KIVO has synced" caption, because the underlying sample is admin-triggered and partial. **Medium.**

168. **Prediction consensus.** Once predictions have volume, "62% of KIVO users picked a home win" is real first-party data. Needs a `SECURITY DEFINER` RPC (predictions are owner-only) and must be suppressed below a minimum sample size so a single vote never renders as "100% of users". **Medium.**

169. **Prediction streaks and accuracy.** Real once scoring exists (item 3). Directly reusable as badge criteria. **Small** on top of item 3.

170. **Fan match ratings.** Users rate a performance after the whistle. This is honest by construction because it is explicitly labelled as fan opinion, not a data-provider rating, and it fills the exact gap where Sofascore-style player ratings are unavailable on the free tier. New table, RLS mirroring `predictions`, aggregate via RPC. **Medium.**

171. **Post-match fan verdict.** Aggregate of item 170 plus match-room reaction counts, rendered as a shareable card. Real user data end to end. **Medium.**

172. **Poll posts.** A post type with two to four user-authored options and real vote counts. Pure user-generated content, no football data dependency, and it works today with zero synced fixtures. **Medium.**

173. **Saved posts and player/team watchlists.** `follows` already models the polymorphic pattern; a `saves` table mirrors it. **Small.**

174. **"Your matchday" module on Home.** Filter today's fixtures to the user's `follows` plus `favourite_team_id`. This is the payoff that makes items 12 and 13 worth doing, and it needs no new data. **Medium.**

175. **Following-filtered social feed.** A toggle between "All" and "Following" on `/social`, using `follows` with `followed_type = 'user'`, which the enum already supports and nothing uses. **Medium.**

176. **A "what KIVO knows" transparency page.** Row counts per entity, last sync per type from `sync_runs`, and remaining provider quota (item 53). On a platform whose core promise is never fabricating data, showing users exactly what is and is not loaded is a differentiating feature, not an admin tool. **Small.**

177. **News: keep it Coming Soon or source it honestly.** There is no news source in the stack and API-Football does not provide one. The only honest options are official club and league RSS feeds with visible attribution and links out, or leaving the surface as-is. Do not fill it with AI-generated summaries of nothing. **Medium** if built.

### Explicitly not buildable (stop re-proposing these)

178. **Transfer rumour confidence tiers.** The prior recommendations log (item 27) proposed a "Confirmed / Here We Go / Advanced Talks / Rumour" taxonomy with a "KIVO-native confidence score". API-Football's `/transfers` returns only completed, recorded moves, so every tier above "Confirmed" would be fabricated, and an aggregated confidence score would be a fabricated number presented as analysis. This directly violates the platform's first rule and should be formally retired in the backlog rather than left as "Proposed". **Retire.**

179. **Market value.** Already correctly documented as permanently out of scope in migration 0007's comments. Recording it here so the reasoning stays visible: no API source, no scraping.

180. **Squad age profiles and player nationality breakdowns.** The free-tier squads endpoint returns neither date of birth nor nationality (documented in `getSquad`'s comment), and deriving a birth date from the `age` field would be estimation. Blocked until a richer provider exists.

181. **Injuries, referee assignments, xG on most competitions.** Not available on the free tier. `fixture_statistics.expected_goals` is correctly modelled as nullable for exactly this reason.

---

## 9. AI Copilot

182. **Resolve followed entities to names in the grounding context.** `buildGroundingContext` currently tells the model "Follows 5 team(s)/player(s)/competition(s) (internal IDs only, no names resolved here)", which is close to useless: it costs tokens and conveys nothing actionable. Join to the entity tables and list the actual names. **Small.**

183. **`hasFollowedEntities` and `hasSyncedFixtures` are computed and never used.** They are returned from `buildGroundingContext` and dropped. Use them to change the UI: swap the suggestion chips, and label the input honestly when nothing is synced. **Small.**

184. **Add fixture-scoped grounding.** An "Ask about this match" entry point on Match Centre that grounds on that fixture's real events, lineups and standings. This is where the grounded-AI pattern is most valuable and where the data is densest. **Medium.** **Status: DONE (2026-08-15).** `AskAiLink` (`src/components/ai/ask-ai-link.tsx`) on Match Centre deep-links to `/ai?ctx=fixture&id=<id>`; `src/lib/ai/grounding.ts`'s `buildGroundingContext` now accepts an optional `GroundingFocus` and, for a fixture, grounds on real teams/competition/kickoff/status plus H2H/form via `buildMatchInsights` (reused, not reimplemented) — not lineups/standings specifically, since Match Intelligence already covers the higher-value H2H/form/goal-timing surface and re-deriving a separate lineups/standings grounding path was judged lower value for this pass's scope.

185. **Add team- and player-scoped grounding** from the entity pages, using the same real rows those pages already render. **Medium.** **Status: DONE (2026-08-15).** Same mechanism as 184 — `AskAiLink` on `teams/[id]` and `players/[id]`, grounding on the real team/player name plus real last-5 form via `computeTeamForm`/`computePlayerForm` (the exact functions those pages already call, not reimplemented). The focus is resent by the client on every turn of a session that started from a deep link (see `chat.tsx`'s `focus` state), not persisted server-side against the conversation row — an acceptable, honest trade-off for this pass: the alternative was a new `ai_conversations` column purely to carry a UI concern, which felt like schema growth for a client-state problem.

186. **Give the model read-only tools instead of one fixed pre-fetch.** The current design retrieves a fixed context before every call, so a question about a team the user did not follow gets "KIVO doesn't have that" even when the row exists. Anthropic tool use with a small set of grounded, RLS-respecting readers (`getTeam`, `getFixture`, `getStandings`, `getPlayerStats`) keeps the honesty guarantee (the tools can only return real rows) while massively widening what the Copilot can correctly answer. **Large.**

    **Scoping note (2026-08-15, explicitly not built this pass — flagged Large by design):** the core change is swapping `/api/ai/chat/route.ts`'s single `anthropic.messages.stream({..., system: [SYSTEM_PROMPT, groundingSummary]})` call (one fixed retrieval before the model ever runs) for a tool-use loop: define 4-5 narrow read-only tools (`getTeam(teamId)`, `getFixture(fixtureId)`, `getStandings(competitionId)`, `getPlayerStats(playerId)`, maybe `searchEntities(query)` for name resolution since the model won't have ids up front), each backed by a thin wrapper around queries this codebase already runs elsewhere (team page's own fetch, `form-engine.ts`, `match-intelligence.ts`) so no new data-access logic is needed, only new call sites. The loop itself: send the system prompt + tools array, read the response for `tool_use` blocks, execute the matching real Supabase query server-side (still RLS/service-role scoped exactly like today, so a tool can never return a row the user couldn't already see), append a `tool_result` message, and re-call the model — repeat until it stops requesting tools, with a hard cap (e.g. 4 rounds) so a confused model can't loop forever. What'd need to change concretely: (1) the streaming shape — today's single NDJSON stream over one `messages.stream()` call becomes a stream-then-pause-then-stream-again shape across tool rounds, which changes the client contract in `chat.tsx` (a `tool_call` frame type would need to exist so the UI can show "checking standings…" rather than going silent mid-turn); (2) cost — each tool round is a full extra model call, so `AI_CHAT_DAILY_MAX_REQUESTS`'s $0-budget-mindset cap (item 190) would need re-tuning against a variable-not-fixed number of model calls per user turn, not the current one-call-per-message assumption; (3) the honesty guarantee shifts from "the context handed to the model is exhaustively pre-verified" to "every tool result is verified, but the model chooses which/how many to call" — still honest (a tool can only return real rows, same as today's pre-fetch), but it's a different failure mode to reason about (a model that *doesn't* call a tool it should have, versus today's model that never had the option); (4) provenance tagging (item 188, shipped this pass) would need to move from "one system-prompt instruction covering a static context block" to something that survives a multi-turn tool loop — likely tagging at the tool-result-append step rather than trusting the model to keep tagging correctly across rounds. Rough risk: medium-high — this is the single biggest architectural lever left in the Copilot, but it's also the one most likely to introduce a real regression (a tool-use loop that never terminates, or a provenance tag that silently stops appearing) if rushed, which is exactly why AGENTS.md flagged it out of this pass rather than asking for a rushed version.

187. **Stream the response.** A 1024-token answer currently appears all at once after a multi-second wait behind three bouncing dots. Streaming is the single biggest perceived-quality improvement available in the chat. **Medium.**

188. **Render provenance explicitly.** The system prompt already asks the model to distinguish verified KIVO data from general knowledge from inference. Have it tag claims and render those tags as visible chips. That turns an invisible prompt rule into a visible product promise. **Medium.** **Status: DONE (2026-08-15).** `grounding.ts`'s summary is now built as two explicitly labelled sections, "VERIFIED KIVO DATA" (raw provider facts) and "KIVO-CALCULATED" (Form Engine/Match Intelligence derived stats) — a structural distinction, not just an instruction. `SYSTEM_PROMPT` (`/api/ai/chat/route.ts`) tells the model to prefix a sentence citing either section with the literal inline tag `[[KIVO-VERIFIED]]`/`[[KIVO-CALCULATED]]`; `chat.tsx`'s `renderMessageContent` turns a tag into a small visible chip (cyan "Verified" / violet "KIVO-calculated") and degrades honestly to plain text if a given reply never uses a tag — nothing breaks, no chip fabricated.

189. **Add a "what KIVO knows right now" disclosure panel** showing `grounding.summary` verbatim. The most honest possible AI interface is one that shows the user its entire context window of facts. **Small.** **Status: DONE (2026-08-15).** A collapsed-by-default panel (toggle via the header's info icon) in `chat.tsx` shows `grounding.summary` verbatim in a scrollable monospace block — the literal string the model receives, not a separately hand-built summary that could drift from reality — plus a freshness line reusing `getTransparencyFreshness()` (the same helper `/transparency` already uses) for "last provider sync" / "quota remaining today", per AGENTS.md's instruction to reuse that logic rather than rebuild it.

190. **Cap cost per user.** No rate limit, no daily message cap, no token accounting. One scripted client can burn the Anthropic budget. Persist token usage per conversation from the response and enforce a daily ceiling. **Small.**

191. **Cache the system prompt.** It is long and constant across every request; prompt caching cuts real cost per call. **Small.**

192. **The chat input is an `<input>`, not a `<textarea>`.** Long questions scroll horizontally and Shift+Enter cannot add a newline. **Small.**

193. **The message list never auto-scrolls to the newest message.** **Small.**

194. **No copy button, no regenerate, no timestamps** on assistant messages. **Small.**

195. **Suggestion chips are hardcoded** and include "What data does KIVO have synced today?", which is a good question the app could answer without the model at all. Make the chips reflect actual state. **Small.**

196. **`AI_MODEL` is read from the environment in `lib/ai/client.ts` but appears in neither `.env.example` nor `ENVIRONMENT.md`.** Undocumented environment variables are how staging silently runs a different model from production. **Small.**

197. **A fantasy assistant is the strongest grounded use case available.** Grounded strictly on the user's own roster, real prices, real fixture schedule and real synced form, with a hard rule against projecting points it cannot compute. Blocked on items 1, 2 and 5. **Large.**

    **Scoping note (2026-08-15, explicitly not built this pass — flagged Large by design):** still genuinely blocked on items 1/2/5 as written — `seasons.is_current` now gets set (item 1 shipped an earlier pass), but `fantasy_gameweeks` is still never inserted and `fantasy_points` is still never written (confirmed against current `src/lib/fantasy-scoring.ts` and the fantasy app routes before writing this note, not assumed stale), so there is no real scored-points data to ground an assistant's "how am I doing" answers in yet — building the assistant first would mean either grounding it in nothing (dishonest) or inventing plausible-looking projections (exactly the fabrication this codebase's standing rule forbids. What this would look like once unblocked: a fourth `GroundingFocus` type (`"fantasy_roster"`), entry point on `/fantasy`'s squad view, grounding on the user's own real roster (`fantasy_rosters`), real player prices already synced, the real upcoming fixture for each rostered player's team (reusing `fixtures` the same way `grounding.ts`'s today's-fixtures block already does), and each player's real recent form (`computePlayerForm`, already reused twice this pass for items 184/185/227 — a fourth reuse, not a new computation). The one genuinely new rule needed beyond what 184/185's pattern already provides: an explicit system-prompt instruction that the model may describe a player's real recent scoring history but must never state a specific *projected* fantasy-points number for an upcoming gameweek, since `fantasy_points` scoring is itself not written yet (item 5) and even once it is, a future score is inherently not a "real synced fact" the way a past one is — this is a new kind of honesty boundary the existing grounding architecture (185/188/189, all shipped this pass) doesn't yet need to express, since everything grounded so far is either a past fact or a present one. Rough risk: low-medium once items 2 and 5 land (the grounding pattern itself is now proven three times over); the real blocker is genuinely upstream, not this item.

---

## 10. Security and abuse resistance

198. **Nothing in the application is rate limited.** Not `/api/ai/chat` (real dollar cost per call), not `createPost`, not `toggleLike`, not `toggleFollow`, not `submitPrediction`, not `setGameweekRoster`, not `joinFantasyLeague`, and not `searchPlatform`, which is callable by unauthenticated guests. The prior log deferred this pending an Upstash decision; it should not survive to a public launch. If adding Redis is unacceptable, a Postgres-backed sliding window keyed on profile id is workable at MVP scale. **Medium.**

199. **`searchPlatform` is the most exposed endpoint in the app:** a guest-callable server action running three unindexed `ilike '%...%'` scans per keystroke-debounce, with wildcards unescaped. Combine items 31 and 39 with a rate limit and a length cap. **Small.**

200. **`ensureFantasyPlayerPrices` lets any signed-in user drive service-role writes.** It is called from `searchFantasyPlayers` on every debounced keystroke and upserts a row per returned player using the RLS-bypassing client. Cap the batch and skip the write when every returned id already has a price. **Small.**

201. **No security headers.** `next.config.ts` sets only image remote patterns. Add a CSP, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy` and `X-Content-Type-Options`. **Small.**

202. **Clerk's `user.deleted` webhook hard-deletes the profile,** cascading away every post, comment, prediction, fantasy team, XP row and badge with no export and no tombstone. That is defensible as a privacy stance but should be a deliberate, documented decision, and orphaned social threads will lose their parent posts. **Medium.**

203. **`user.updated` overwrites `display_name` and `avatar_url` from Clerk unconditionally.** Harmless today because KIVO exposes no editor for either, but it will silently revert user edits the moment item 16 ships. **Small.**

204. **Every failure path is `console.error`.** No Sentry, no structured logging, no request correlation. In a serverless deployment these are effectively write-only. **Small.**

---

## 11. Platform, ops and testing

205. **There are no tests of any kind** and no test runner in `package.json`. **Medium** to establish.

206. **`validateRoster` in `fantasy-rules.ts` is the highest-value unit-test target in the codebase:** pure, framework-free, deliberately shared between client and server as the single source of truth for squad legality, and about a hundred lines of branching rules. It has zero coverage. **Small.**

207. **The provider normalizers are the second target:** `mapStatus`, `mapEventType`, `mapTransferType`, `positionGroup` and `formatDeadlineCountdown` are all pure functions encoding provider quirks, and a regression in any of them silently corrupts stored data. **Small.**

208. **The RLS policies are the third target.** A small integration suite asserting that a non-owner cannot read another user's predictions, fantasy roster or notifications would protect the most security-critical part of the system. **Medium.**

209. **There is no CI.** No `.github/workflows`, so `eslint`, `tsc --noEmit` and `next build` never run automatically on a commit. Given how much of this codebase's correctness rests on TypeScript, that is the cheapest quality gate available. **Small.**

210. **`package.json` has no `typecheck` script,** even though `README.md` documents `npx tsc --noEmit` as a standard command. **Small.**

211. **No error tracking.** Add Sentry (or equivalent) with source maps, and tag events with the sync run id where relevant. **Small.**

212. **No analytics.** Privacy-respecting, cookieless options (Vercel Analytics, Plausible) would answer the question the roadmap most needs answered: which of the sixteen nav destinations do people actually open. **Small.**

213. **Data Health is the de facto observability surface but shows only the last ten runs** with no aggregate: no success rate, no records-over-time, no quota trend. Add a small summary strip. **Small.**

214. **No health check endpoint** for uptime monitoring. **Small.**

215. **No `engines` field and no `.nvmrc`,** so the Node version is whatever the deploy target defaults to. **Small.**

---

## 12. Documentation and consistency

216. **`ARCHITECTURE.md`'s "What's real vs. architected-but-not-live" section is materially out of date.** It says fantasy and predictions have "full schema live, no UI yet" and that the AI Copilot has "no model wired". All three now have shipped UI. Someone reading the docs to decide what to build next would be misled. **Small.**

217. **`ARCHITECTURE.md` says "34 tables"** and migrations 0005 through 0007 have since added three more. **Small.**

218. **`README.md`'s project structure predates most of the app,** listing only `(app)`, `admin`, sign-in/up and the Clerk webhook, with none of teams, players, leagues, matches, fantasy, predictions, transfers, discover, live, rewards or the AI route. **Small.**

219. **`README.md` still points at `RECOMMENDATIONS.md` as "the continuously-updated product/UX backlog".** Update the description to match this document, and note where the prior research log lives in git history. **Small.**

220. **`ENVIRONMENT.md` documented variables that nothing reads** (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CRON_SECRET`, `WEBHOOK_SECRET`) and omitted one that is read (`AI_MODEL`, item 196). Fixed — reserved ones now live in their own section. **Status: DONE (2026-08-15).** `SPORTMONKS_API_TOKEN`, also flagged here originally, is no longer relevant: Sportmonks was dropped from the project entirely per founder directive (see `DECISIONS.md`), and `THE_SPORTS_DB_API_KEY`/`FOOTBALL_DATA_PROVIDER` took its place as a real, implemented second provider rather than a reserved-but-unread stub. **Small.**

221. **Placeholder glyphs are inconsistent across the product.** The codebase uses `-`, `–`, `—`, `"–"`, `"Not yet synced"` and `"No further details on record"` for the same "no value here" concept, sometimes two of them on the same screen. Standardise on one glyph plus one prose form. Note also that the em dash placeholders in `transfers/page.tsx` and `players/[id]/page.tsx` sit against the house rule that no user-facing text uses em dashes. **Small.**

222. **Score separators mix en dash and hyphen.** `–` in fixture scores, `-` in standings positions and shirt numbers. Pick one. **Small.**

223. **Empty-state copy has three distinct voices:** the honest-technical ("An admin can trigger a sync from Data Health", which leaks internal roles to ordinary users), the friendly ("Nobody's posted yet. Be the first"), and the neutral ("No results synced yet"). Write one voice guide and apply it. In particular, ordinary users should not be told about admin actions they cannot take. **Small.**

224. **The prior recommendations log's item 27 should be formally retired**, not left as "Proposed" (see item 178). Leaving a fabrication-dependent idea marked as an accepted-adjacent proposal in the backlog is how it eventually gets built. **Small.**

---

## 13. KIVO intelligence layer (Form/Rating/Heatmap engines, this pass)

225. **Calibrate the Rating Engine against real synced matches before wiring it to any UI.** `src/lib/football/rating-engine.ts` and `RATING_WEIGHTS` are reasoned defaults extending `fantasy-scoring.ts`'s existing position-weighting convention, unit-tested against hand-built inputs only — never spot-checked against a real hat-trick, a real disciplinary nightmare, or a real quiet game once enough fixtures have `lineups` + `fixture_events` + final scores synced. Do that spot-check first, then wire into `players/[id]/page.tsx` (a "Match ratings" section) or the Match Centre lineup view, gated behind the same "insufficient sample" honesty pattern `form-engine.ts` already established. See `docs/RATING_ENGINE.md`. **Medium.** **Status (2026-08-15): tooling built, calibration NOT done.** `scripts/calibrate-rating-engine.ts` (`npm run calibrate:ratings`) now exists and will produce a real distribution/extremes/win-loss-sanity report the moment real finished-fixture data exists — but the live project was queried directly this pass and has zero finished fixtures, so there was no real signal to calibrate against. No synthetic data was used and `RATING_WEIGHTS` was not touched. See `docs/RATING_ENGINE.md`'s new "Calibration checklist" for the concrete, checkable bar this item is still waiting on.

226. **Unify H2H, Form, and goal-timing into one `MatchInsights` object** the AI Copilot and a future match-preview surface can both consume, per the original brief's Part 1 framing. Today `head-to-head.ts`, `form-engine.ts`, and the ad hoc goal-timing block in `teams/[id]/page.tsx` are three separate reads instead of one composed retrieval — the AI Copilot in particular would benefit from one grounding call instead of hand-adding each engine's output one at a time (see item 227). **Medium.**

227. **Extend the Form Engine's grounding enrichment (`src/lib/ai/grounding.ts`) from "favourite team only" to every followed team**, and to followed players' recent involvement (reusing the same lineups→`resolveFixtureResult`→`computePlayerForm` pattern `players/[id]/page.tsx`'s "Recent form" section now uses for one player). This pass scoped the enrichment to the single favourite team specifically to keep the extra query bounded and low-risk; the pattern is proven and the extension is mechanical. See `docs/AI_COPILOT.md`. **Small.**

228. **Add a "Heatmap" tab to `match-centre-tabs.tsx` once a decision is made** on whether to show the honest "unavailable" `HeatmapView` state on a live surface today, or wait until a real `PositionalDataProvider` implementation exists. The component (`src/components/matches/heatmap-view.tsx`) and engine (`src/lib/football/heatmap-engine.ts`) are both already built and tested — this is purely a product call, not an engineering blocker. See `docs/HEATMAP_ENGINE.md`. **Small.** **Status: DONE (2026-08-15).** The product decision was made — show the honest empty state on a live tab today. `MatchCentreTabs` now has a "Heatmap" tab rendering two `HeatmapView`s (home/away) with `observations={[]}`, since no `PositionalDataProvider` is connected; both always show the "Positional data unavailable for this match" empty state, which is correct, expected behaviour, not a bug.

229. **Season-average KIVO ratings surfaced on `teams/[id]/page.tsx`'s squad list** (e.g. a small rating chip per player) is the natural next UI target once item 225's calibration pass is done — `aggregateSeasonRating()` already exists and already refuses to present a misleadingly small sample as reliable (`isSufficientSample`, `MIN_RATING_SAMPLE = 3`). **Medium**, blocked on 225. **Status (2026-08-15): still correctly blocked.** Item 225's calibration tooling now exists but the live project has zero finished fixtures, so no calibration has actually happened — this item was deliberately not attempted this pass. Do not wire UI here until item 225's checklist in `docs/RATING_ENGINE.md` is real and checked.

230. **`lineups.pitch_heatmap` (added by migration 0036, still present after 0039 deliberately left it alone) is an unused, always-null JSON column** that predates `HeatmapEngine`'s own coordinate/observation model (`PositionalObservation[]`, canonical `PITCH_DIMENSIONS`). Once a real `PositionalDataProvider` is connected, decide whether raw per-fixture observations belong in a new dedicated table (matching `PositionalObservation`'s shape) rather than this column, or whether this column should be repurposed/dropped. Not decided this pass — flagging so it isn't mistaken for a live, populated field. **Small.**

---

## 14. KIVO avatar/background asset pack — remaster needed

The founder supplied 18 avatar designs, 12 background designs, and one match-share-card template (`main@1f9983f`, six source sheets). Every avatar/background panel was inspected individually before any cropping, per the founder's explicit process: crop only where the baked-in "KIVO" watermark or corner number sits in genuinely removable space, never where doing so would cut into the character, clothing, props, lighting, or composition. Verified by actually rendering each candidate crop and looking at it, not assuming.

**Result: 5 of 18 avatars and 10 of 12 backgrounds were clean-croppable and are live** at `public/assets/kivo/avatars/` and `public/assets/kivo/backgrounds/` — `kivo-avatar-06/08/11/12/17.webp`, `kivo-bg-01/02/04/05/07/08/09/10/11/12.webp`. The match-card template needed no processing (already a single clean full-canvas asset) and is live at `public/assets/kivo/match-card/kivo-match-card-background.webp`.

**231. The remaining 13 avatars need a remastered source before they can be shipped** — the baked-in "KIVO" wordmark and/or the large corner number sit in pixels that overlap the character's pose in every case tried, so no rectangular crop removes them without cutting into the art:
- **kivo-avatar-01**: cape extends through the entire bottom-right corner where the number sits.
- **kivo-avatar-02**: ball and character fill the frame; watermark and number both overlap the pose.
- **kivo-avatar-03**: the pointing hand/glove extends into the top-right watermark zone.
- **kivo-avatar-04**: the kick pose extends to the bottom-right corner; trimming cuts the shoe.
- **kivo-avatar-05**: the leg/shoe occupies the bottom-center, flanked by the watermark and number with no single rectangular crop that excludes both.
- **kivo-avatar-07**: the KIVO wordmark overlaps the hair; the number overlaps near the ball/foot.
- **kivo-avatar-09**: the arm extends into the top-left watermark zone; the kick pose fills the frame.
- **kivo-avatar-10**: the ball sits directly beside the bottom-right number; the character fills nearly the whole frame.
- **kivo-avatar-13**: a fragment of the wordmark remains next to the crown decoration even after trimming; the ball/arm prevent trimming further.
- **kivo-avatar-14**: arms fully extended edge-to-edge, no dead space on either side.
- **kivo-avatar-15**: the goalkeeper's head already sits close to the top edge; trimming enough to clear the watermark cuts into the face.
- **kivo-avatar-16**: the crouched pose already reaches close to the top edge; trimming cuts the head.
- **kivo-avatar-18**: a fragment of the wordmark remains after trimming; the ball/hand prevent trimming further.

**Fix**: request a remastered version of each from whoever generates the source art, with the KIVO wordmark and player number kept clear of the character/props (e.g. in a fixed, generous margin band), OR with no baked-in wordmark/number at all — the same problem will recur on the next batch otherwise. **Medium** (art, not engineering).

**232. Two backgrounds need a remastered source for a different reason** — the "KIVO" branding isn't a corner overlay here, it's rendered as diegetic content inside the scene itself:
- **kivo-bg-03**: "KIVO" is a glowing marking on the pitch itself.
- **kivo-bg-06**: "KIVO"/"FOOTBALL TOGETHER LIVE" is rendered as building signage within the scene.

Cropping either down far enough to exclude it loses most of the artwork. **Fix**: same as above, ask for these two specifically without in-scene text, or accept them as brand-forward "KIVO stadium" background options rather than neutral ones (a legitimate product call, not an engineering one — flagging for a decision rather than making it unilaterally). **Small** (art, not engineering).

Until remastered, the avatar-selection and background-selection UI should only offer the 5/10 confirmed-clean options — do not fall back to showing the flagged ones with a visible number/watermark just to hit "18" and "12"; that violates the founder's own explicit rule more directly than shipping fewer options does.

---

## If you only do 10 things

Ordered by leverage, weighing "unblocks a whole feature" over "polishes a working one".

1. **Set `seasons.is_current` in the sync (item 1) and generate `fantasy_gameweeks` from real fixtures (item 2).** These two together unblock the entire fantasy product, the largest single body of code in the repo, which currently cannot be reached at all.

2. **Fix the guest author-name bug (item 20) with a public profiles view (item 21).** Every signed-out visitor currently sees "KIVO fan" on every post, on the platform's most public and most shareable surface.

3. **Ship prediction scoring plus the leaderboard RPC (items 3 and 4).** Predictions is a complete, working feature with no ending. Scoring turns a submission form into a game and feeds XP, badges and streaks for free.

4. **Add the report flow (item 6).** The moderation queue, urgency badges and audit trail are all built and can never receive a single item. This is a few hours of work that activates an entire admin surface, and it is a launch prerequisite for user-generated content.

5. **Build Match Rooms on `posts.fixture_id` (item 8).** The schema supports it, the landing page already sells it, and it is the differentiator the competitive research identified as the clearest greenfield opportunity. It also works with zero live data.

6. **Carry a redirect through every sign-up gate (item 102), and point the landing CTA at sign-up (item 103).** The cheapest conversion fix in the document: right now every gated action dumps the user on `/home` and the primary landing button converts nobody.

7. **Add `error.tsx`, per-route `loading.tsx`, and `generateMetadata` on the four detail routes (items 89, 90, 93).** Together these cover the three failure modes a real user hits first: a slow page, a broken page, and a shared link that looks like nothing.

8. **Cache `getOrCreateProfile` and the Supabase client per request, and suspend the notification fetch (items 78 and 79).** Every server render currently does the same auth and profile work two to four times and blocks the shell on a notifications query. This is a measurable latency win across the entire app for a very small diff.

9. **Fix the three real bugs: AI history order (item 19), fantasy position filter after limit (item 84), and the like-count revert (item 118).** All three are small, all three are currently wrong, and the first two make their features behave incorrectly rather than just imperfectly.

10. **Extract the duplicated primitives (`TeamCrest`, fixture status, `positionGroup`, `timeAgo`) and the sync mapping helpers (items 66 to 69, 29).** Eight copies of the same crest component and four copies of the same provider-mapping logic is the main structural debt in a codebase that is otherwise unusually well reasoned. Doing this now, while the copies are still identical, is an afternoon; doing it after they drift is a week.
