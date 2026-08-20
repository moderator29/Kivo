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
| `fantasy_points` / `fantasy_roster_carried` | A gameweek is scored | `admin/football/fantasy-actions.ts` |
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

### Per-entity mutes (migration 0104)

Each audience is then filtered by what that person has actually muted, and the
filter runs **per audience, before the union**. Somebody who follows both clubs
in a derby and has muted one of them still gets the derby — they are in the
audience twice and only one of the two reasons was silenced. Filtering the
union would take the match away from them entirely.

Two stores are consulted and a row in either one means muted:

| Store | Written by | Reaches |
|---|---|---|
| `follows.muted` | the mute toggle beside the follow star | teams and players the user follows |
| `notification_mutes` | Settings → Notifications | teams, players and competitions, **followed or not** |

The second exists because the first cannot reach the two entities people most
want to silence. A **favourite club** has no `follows` row — it lives in
`profiles.favourite_team_id` — so until 0104 the club somebody cares most about
was the one club they could not turn down. And **competitions** had no
notification control at all, despite `follows` carrying
`followed_type = 'competition'` since 0001 with no producer ever reading it.
"Keep the league, silence the cup" was unexpressible.

Honouring both stores rather than migrating one into the other means nothing
that was already muted becomes unmuted. Unmuting from Settings clears both,
so the switch never reports a state it did not achieve.

The competition is read from the fixture inside the producer rather than
threaded through every call site, and a fixture whose competition cannot be read
simply has no competition target — the notification still goes out. That is the
right failure direction for a filter that only ever subtracts.

`notification_mutes` deliberately refuses `target_type = 'user'`, even though
the enum allows it. Silencing a person is blocking, which KIVO already has with
its own reciprocal-visibility rules; a second, quieter way to express it that
looked like the real thing would be worse than not offering it.

---

## 4. Preferences

Eight booleans on `notification_preferences`. The gate is `filterNotifiable` / `resolveNotifiableRecipients`, called by every producer before writing.

Two rules worth knowing:

- **An absent row means defaults, which means notify.** A user who has never opened Settings has no preference row. Missing from the result set means "hasn't set a preference", never "opted out".
- **It fails closed.** An unreadable preference is not consent, so a chunk that errors is treated as blocked, logged, and does not abort the rest of the fan-out.

`in_app_enabled` is folded into every category check, because in-app is the only channel that exists — a category being on cannot matter if the one real channel is off. When a second channel ships this must become channel-aware rather than a blanket fold-in.

The lookup is chunked at 300 ids per query, because an audience is unbounded by nature and the ids travel in a URL-encoded `in.(...)` filter.

These eight booleans decide notification **types**; the per-entity mutes in §3
decide which clubs, players and competitions they are about. Both halves live on
Settings → Notifications, next to each other rather than a page apart, because
"turn off match alerts" and "turn off match alerts *for this club*" are the same
question at two levels and a fan who can only reach the first one turns the lot
off. The mute list only ever offers entities that can actually produce a
notification for that person — their club, and what they follow — because a
searchable directory of every club in the database would be a page full of
switches that change nothing.

The mute filter fails **open**, unlike the preference gate, and the asymmetry is
deliberate. An unreadable *preference* is not consent, so that fails closed. An
unreadable *mute* is a transient error on a filter that only ever subtracts, and
failing closed there would silence every notification for everybody for the
duration of the fault.

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

## 7. Batching and deduplication

The brief asks for "intelligent batching". Half of it exists as a property of the design rather than as a feature: everything produced inside one quiet window carries the same `quiet_until`, so a night of notifications surfaces together when the window ends. That is deferred *surfacing*.

**Real batching does not exist, and is not half-built.** Collapsing four goals into "4 goals in Arsenal v Chelsea" requires collecting events over a delay and then writing a summary — a job that wakes up, reads what accumulated, and produces a new row. KIVO has one cron entry point, not a job queue, and there is no scheduler that can hold a notification and revisit it.

Building it would mean either a new scheduled worker with its own failure modes and quota, or writing a "pending" notification and mutating it later, which breaks the append-only property that makes the current table easy to reason about. Neither is a small change, and a half-built version — one that batched sometimes, or only within a single sync run — would be worse than none, because it would make the delivery contract unpredictable.

### Deduplication

Real, and enforced in two different ways on purpose, because there are two
genuinely different questions hiding under one word.

**"Is this the same real-world event?"** — a unique index on
`(profile_id, dedupe_key)` (migration 0104), resolved according to the type's
own `NOTIFICATION_DEDUPE_MODE`. Producers build the key from the event's own
identity; what happens on a conflict is declared once in the registry, not
decided per producer. This is what covers a retried sync, a fixture whose
status flaps `live → halftime → live → halftime`, and any future producer that
happens to overlap an existing one. Before it, every producer deduplicated with
an in-memory `Set` inside one function call — correct for the case it was
written for (one person who both favourites the club and follows the scorer)
and blind to everything outside that call.

Keys are built from the same natural key the data layer uses: for a match event
that is fixture + type + minute + player, which is exactly what
`fixture_events` is keyed on. Choosing a looser identity — "one goal per player
per match" — would make the notification layer disagree with the table it
reports on and would swallow a real second goal from the same striker. The
honest consequence, worth stating rather than hiding: if a provider *corrects* a
goal's minute from 45 to 45+2, `fixture_events` treats that as a different event
and so does this, so it can still notify twice. Fixing that means changing what
KIVO considers one event, which is a data-layer decision, not a notification one.

A null `dedupe_key` never deduplicates (`NULLS DISTINCT`), so producers with no
meaningful identity to offer are unaffected — two replies to one post are two
notifications, not a duplicate.

#### Ignore, or supersede?

`on conflict do nothing` is the obvious resolution and it is wrong for a whole
class of type. A seeded account's bell held six fantasy notifications where
three belonged: gameweeks 3 and 4 had each notified twice, and gameweek 4
appeared with **two different totals, 28 and 36**, while `fantasy_points` held
only 36 — as did the home tile, the scorecard and the share card. The 28 existed
nowhere else in KIVO and sat in a notification a fan would read as
authoritative.

Ignoring the duplicate would have kept the 28 and discarded the 36. For a
re-scored gameweek the second write is not a duplicate at all; it is a
correction, and the newer value is the true one.

So the rule turns on *why* the second write happened, which is knowable from the
type:

| Mode | Types | Because |
|---|---|---|
| `none` | `post_like`, `new_follower`, `post_comment`, `comment_reply` | Two occurrences are two notifications. The toggle-shaped pair use the unread-scoped rule below instead. |
| `ignore` | goals, penalties, red cards, kickoff, lineups, `player_event`, `badge_earned` | A one-time event. Re-syncing re-reads it; it does not repeat it, and the first row already says it correctly. |
| `supersede` | `fantasy_points`, `fantasy_roster_carried`, `match_halftime`, `match_result`, `transfer_recorded`, `prediction_result` | The payload is **computed**, so it can be recomputed to a better answer. |

Superseding replaces the payload in place, moves `created_at` to now and clears
`read_at` — a fan who read "you scored 28" needs to see the corrected 36, and
leaving it read hides the correction behind the thing it corrects.

It does all of that **only when the payload actually differs**, which is why it
goes through `upsert_notifications_superseding` (migration 0105) rather than a
plain upsert: PostgREST cannot emit the `DO UPDATE ... WHERE` that makes the
no-change case a genuine no-op. Without it, an ordinary re-sync would bump every
full-time notification back to the top of the bell and mark it unread again — a
re-notification carrying no new information, which is the exact spam this
mechanism exists to prevent.

Verified against the live database inside a transaction that was then aborted:
one row rather than two, final value 36 rather than 28, and an identical re-run
updating zero rows, leaving `read_at` set and `created_at` unchanged.

**"Is this already sitting unread in their bell?"** — a scoped lookup before
writing, used by `notifyPostLiked` and `notifyNewFollower`. Likes and follows
are toggles: one tap each way, repeatable forever. The rule there is
deliberately *don't stack unread duplicates*, not *notify once, ever* — once the
recipient has read the last one, a later reaction or a re-follow months on is
genuinely new information. The unique index cannot express that, because its
constraint is permanent; using it on these two would have silently converted a
considered rule into a stricter one. Both checks fail **open**: if KIVO cannot
tell whether a duplicate exists, one extra notification is a much smaller harm
than dropping the only one somebody was going to get.

---

## 8. Reading

- The bell shows the 20 most recent, filtered by the viewer's own blocks. The **unread count is not adjusted** — it counts real unread rows, and quietly shrinking it would leave a badge that disagrees with the list it opens.
- `/notifications` pages 30 at a time with five filter chips (Matches, Transfers, Social, Predictions, Fantasy, You), each carrying a real count. A group with nothing in it is not rendered, so the filter row only ever offers filters that lead somewhere.
- Filtering happens in the query, not in the browser: filtering the current page client-side would show "Social" as empty for someone whose replies are on page 3.
- Notifications about goals by a player in the reader's own fantasy XI are decorated at read time, from the current squad — never stamped at write time, because a squad changes and "your captain scored this" would still be claiming a captaincy transferred out three weeks ago.
