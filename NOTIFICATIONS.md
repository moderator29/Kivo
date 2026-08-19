# KIVO — Notifications

Every notification type, every producer, and the two things the founding brief asks for that KIVO cannot honestly build yet.

**The one fact that shapes everything below: KIVO has exactly one delivery channel, and it is in-app.** A notification is a row in `notifications` that sits in a list until the person opens the app. There is no push (no service worker, no APNs/FCM credentials) and no email (Resend keys reserved, unused). `notification_deliveries` exists as a table and has no producer. Nothing in this document should be read as implying otherwise.

---

## 1. Types

`notifications.type` is free text in the schema by design — types grow continuously — so the union in `src/lib/notification-registry.ts` is KIVO's own registry rather than a database constraint. Every type has a title, an icon, a destination and a group. Adding one starts there.

### Wired to a real producer

| Type | Fires when | Producer |
|---|---|---|
| `match_lineups` | A fixture goes from holding no lineup rows to holding some | `notifyLineupsReleased`, `sync-match-details.ts` |
| `match_kickoff` | Status transitions to `live` | `notifyFixtureStatusChange`, `sync.ts` |
| `match_goal` | A real `fixture_events` goal row is inserted | `notifyFixtureEvent` |
| `match_penalty` | A `penalty_goal` or `penalty_missed` event | `notifyFixtureEvent` |
| `match_red_card` | A `red_card` or `second_yellow_card` event | `notifyFixtureEvent` |
| `match_halftime` | Status transitions to `halftime` | `notifyFixtureStatusChange` |
| `match_result` | Status transitions to `finished` | `notifyFixtureStatusChange` |
| `player_event` | Any other event involving a followed player | `notifyFixtureEvent` |
| `post_like` | Somebody reacts to your post | `social/actions.ts` |
| `post_comment` / `comment_reply` | Somebody comments or replies | `social/comment-actions.ts` |
| `new_follower` | Somebody follows you | `follow-actions.ts` |
| `fantasy_points` / `fantasy_roster_carried` | A gameweek is scored | `admin/data-health/fantasy-actions.ts` |
| `transfer_recorded` | A transfer involving a followed entity is synced | `transfer-notifications.ts` |

### Registered, no producer yet

`prediction_result`, `prediction_reminder`, `fantasy_deadline`, `badge_earned`, `moderation_outcome`. They are in the registry so that when a producer ships, the UI already knows how to render and link them — never so that a raw `snake_case` string reaches a user.

### Three that were added because the data was already there

`match_halftime`, `match_penalty` and `match_lineups` are named in the founding brief and every one of them existed in KIVO's own database and reached nobody:

- `fixture_status` has carried `halftime` since migration 0001; the status-change producer branched on `live` and `finished` only. A real, observed transition was being watched and discarded.
- Both penalty event types existed. A scored penalty went out as a generic goal; a missed one reached only the taker's own followers — the group least surprised by it.
- `lineups` rows are written by KIVO itself. Team news is the most time-sensitive pre-match moment in football and produced nothing.

`match_lineups` fires only on the transition from no lineup to some lineup. A details re-sync over a lineup KIVO already held notifies nobody — the same discipline `upsertFixtureEvent`'s dedupe branch applies to goals.

---

## 2. Payload

`notifications.payload` is jsonb, guarded twice and deliberately not the same guard twice:

- **Compile time** — `NotificationPayloadByType` (`src/lib/notification-payloads.ts`) is a discriminated union, and `buildNotification(profileId, type, payload)` is the only constructor. A producer cannot omit a field its renderer needs.
- **Run time** — `notification_payload_is_valid(type, payload)` is a `CHECK` constraint (migrations 0061, 0087), for anything that reaches the table another way.

The validator is deliberately permissive about types it does not recognise (`else true`): a type that shipped after it is a new feature, not an error. That is exactly why 0087 had to teach it the three new shapes — otherwise the newest types in the system would have quietly opted out of the guarantee the constraint exists to provide.

Match payloads carry a `summary` built at produce time, because the renderer has no access to team names or a score.

---

## 3. Audience

Real, queryable state. No inferred audience anywhere.

- **A team's audience** = `profiles.favourite_team_id` + `follows` rows for that team where `muted = false`.
- **A player's audience** = `follows` rows for that player where `muted = false`.
- Goals, penalties and red cards notify the involved team's audience *and* the player's own followers, deduplicated so somebody who both favourites the club and follows the player gets one row.
- Every other event type notifies only the involved player's followers, so a routine yellow card does not page everyone who supports the club.

`profiles.favourite_team_id` has no per-entity mute — a favourite club is not mutable that way today, and that is stated rather than papered over.

---

## 4. Preferences

Eight booleans on `notification_preferences`. The gate is `filterNotifiable` / `resolveNotifiableRecipients`, called by every producer before writing.

Two rules worth knowing:

- **An absent row means defaults, which means notify.** A user who has never opened Settings has no preference row. Missing from the result set means "hasn't set a preference", never "opted out".
- **It fails closed.** An unreadable preference is not consent, so a chunk that errors is treated as blocked, logged, and does not abort the rest of the fan-out.

`in_app_enabled` is folded into every category check, because in-app is the only channel that exists — a category being on cannot matter if the one real channel is off. When a second channel ships this must become channel-aware rather than a blanket fold-in.

The lookup is chunked at 300 ids per query, because an audience is unbounded by nature and the ids travel in a URL-encoded `in.(...)` filter.

---

## 5. Quiet hours

Migration 0088. This is the part where the honest answer and the expected answer differ, so it is spelled out.

**What quiet hours cannot do here.** Nothing arrives on a phone, so there is no arrival to suppress. And suppressing the row would be worse than doing nothing: a goal at 2am is still a goal somebody wants to read at 8am, and dropping it destroys information they asked for.

**What they do instead.** The row is always written and always readable. What it does not do, until the window ends, is drive the unread badge — the only thing in KIVO that currently interrupts anyone. `notifications.quiet_until` holds the instant it stops being held back, stamped at produce time.

Stamped at write time rather than evaluated at read time on purpose: "was this person in their quiet hours when it happened" is a fact about a moment that has passed, and recomputing it later against preferences that may have changed would answer a different question.

**Timezone.** The window is stored as `time` with no offset, because "not after ten at night" is a wall-clock intention that stays true across a DST change precisely by not carrying one. The offset arrives at evaluation time from `profiles.timezone`.

Quiet hours **do not apply** — and the Settings screen says which — when:

| Condition | Why it delivers normally |
|---|---|
| Disabled (the default) | KIVO does not guess when anybody sleeps. |
| No stated timezone | KIVO never infers a zone from a connection. Applying UTC to somebody in Lagos would hold their notifications back by the wrong hour. |
| Unparseable window | A stored value the code cannot read is a bug; silencing somebody on a bad value is the worse failure. |
| Zone this runtime cannot resolve | Same. |
| Start equal to end | Reads as both "never" and "always", so it is allowed to mean neither. |

One honest inaccuracy, written down rather than hidden: the window's end is computed by adding wall-clock minutes as elapsed time, so a DST transition *inside* a window can move the badge an hour either way, twice a year.

---

## 6. Priority

Three levels, and **not a database column**. Every row of a type has the same priority forever, so a column would duplicate a fact that already lives in the registry beside the type's title and icon, and would let two rows of one type disagree. What reaches the database is the consequence: high priority means a null `quiet_until`.

The line is drawn on one question — what does this person lose by reading it in the morning?

| Level | Types | Reasoning |
|---|---|---|
| `high` | `fantasy_deadline`, `moderation_outcome` | A missed deadline is a lost gameweek; a moderation outcome is about their standing here. The only two where waiting has a real cost. |
| `normal` | Everything football | A goal matters and it keeps. The match will still have finished the same way. |
| `low` | `post_like`, `new_follower` | Pleasant, and nothing is lost by reading it later. |

---

## 7. Batching — what exists, and what does not

The brief asks for "intelligent batching". Half of it exists as a property of the design rather than as a feature: everything produced inside one quiet window carries the same `quiet_until`, so a night of notifications surfaces together when the window ends. That is deferred *surfacing*.

**Real batching does not exist, and is not half-built.** Collapsing four goals into "4 goals in Arsenal v Chelsea" requires collecting events over a delay and then writing a summary — a job that wakes up, reads what accumulated, and produces a new row. KIVO has one cron entry point, not a job queue, and there is no scheduler that can hold a notification and revisit it.

Building it would mean either a new scheduled worker with its own failure modes and quota, or writing a "pending" notification and mutating it later, which breaks the append-only property that makes the current table easy to reason about. Neither is a small change, and a half-built version — one that batched sometimes, or only within a single sync run — would be worse than none, because it would make the delivery contract unpredictable.

The other half of the brief's requirement, **deduplication**, is real: `notifyPostLiked` refuses to write a second unread like notification for the same post, so thirty taps on a reaction cannot put thirty rows in one author's bell.

---

## 8. Reading

- The bell shows the 20 most recent, filtered by the viewer's own blocks. The **unread count is not adjusted** — it counts real unread rows, and quietly shrinking it would leave a badge that disagrees with the list it opens.
- `/notifications` pages 30 at a time with five filter chips (Matches, Transfers, Social, Predictions, Fantasy, You), each carrying a real count. A group with nothing in it is not rendered, so the filter row only ever offers filters that lead somewhere.
- Filtering happens in the query, not in the browser: filtering the current page client-side would show "Social" as empty for someone whose replies are on page 3.
- Notifications about goals by a player in the reader's own fantasy XI are decorated at read time, from the current squad — never stamped at write time, because a squad changes and "your captain scored this" would still be claiming a captaincy transferred out three weeks ago.
