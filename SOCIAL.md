# KIVO — Social

The social layer, as built. Every table, policy and rule named here exists; where something is missing it says so.

The founding brief calls social an MVP pillar rather than a later phase, and the shape reflects that: posts, one-level comment threads, six reactions, polls (freeform and templated), Match Rooms attached to real fixtures, a follow graph, saves, reports, admin moderation, self-service blocking, and trending — all on real rows, with no seeded content anywhere.

---

## 1. The object model

| Table | What it is | Migration |
|---|---|---|
| `posts` | A take. `fixture_id` set means it lives in that match's Room. `is_system` means KIVO wrote it. `poll_kind` names a templated poll. | 0001, 0047, 0078 |
| `comments` | One level deep. `parent_comment_id` exists but the UI only ever sets it to a top-level comment. | 0001 |
| `reactions` | Six types: like, fire, clap, laugh, wow, sad. Polymorphic over post/comment. | 0001 |
| `poll_options` / `poll_votes` | A poll is a post that has options. No `is_poll` column. | 0032 |
| `follows` | Polymorphic: team, player, competition, user. `muted` silences one target without unfollowing. | 0001, 0049 |
| `saves` | Post, team or player. Exact mirror of `follows`. | 0032 |
| `blocks` | Self-service, reciprocal in visibility, one-sided in ownership. | 0086 |
| `reports` | Carries a content snapshot, so moderation does not depend on the live row surviving. | 0001, 0022 |
| `fan_ratings` | 1-5 on a finished fixture. Fan opinion, never conflated with provider data. | 0032 |

**A poll is a post with options, not a post with a type column.** The post's `body` is the question, reusing the length constraint posts already have. Two small tables instead of a jsonb blob, so counting votes stays a `group by` and a foreign key rather than hand-rolled jsonb arithmetic.

---

## 2. Match Rooms

A Room is not a separate feature. It is `posts.fixture_id` being non-null, rendered on Match Centre's Room tab, using the same `PostCard`, comment thread and reaction infrastructure as `/social`.

What makes it feel live:

- **Realtime posts** (`use-realtime-room-posts.ts`) — every new post appears for everyone on the tab, no refresh. Room auto-appends rather than showing `/social`'s click-to-reveal pill, because a live match is a conversation and a hidden-until-clicked message is a worse one.
- **Presence** — who is watching, and who is typing. Keyed by profile id so two tabs of one person count once. The name is used only for the typing line, never for the count.
- **System posts** (`is_system`, migration 0047) — KIVO announces real goals and red cards from real `fixture_events` rows. Locked to `false` on any self-service write; only a service-role write can set it true.

### Templated polls

The brief names two poll types by name, and both are first-class kinds rather than pre-filled text boxes (migration 0078):

- **Man of the match** — seeded from the fixture's real synced starting XIs, with each option carrying a real `players.id`. When no lineup is synced, the action refuses out loud and posts nothing rather than opening an empty ballot. One per fixture, enforced by a partial unique index.
- **Referee decision** — a fixed list of five decisions (penalty, red card, offside, disallowed goal, VAR) and always the same three answers: right call, wrong call, not sure. Several per match, because a match genuinely contains several disputed decisions. The third answer is not padding: a two-option poll forces every undecided viewer into a side and produces a number that reads like consensus and is not one.

The player link is what makes an MOTM poll *readable later* — it is the only real answer KIVO has to "who was man of the match", and it is what a MOTM prediction is settled against (see `src/lib/predictions.ts`).

A ballot longer than six options collapses to the top few by real vote count, and the collapsed slice always includes the viewer's own pick even when it is twelfth — a voter who opens a poll and sees no trace of their vote reasonably concludes it was lost.

---

## 3. Visibility: three independent gates

A post is visible when all three agree. They are separate mechanisms with separate owners, and conflating them would be a bug.

1. **Moderation** (migration 0045) — `active` / `shadow_muted` / `suspended` / `banned`, set by an admin. A shadow-muted author's posts are visible to themselves and to admins and to nobody else, enforced in `posts_select_public` rather than in a component.
2. **Blocks** (migration 0086) — one user's own decision. Reciprocal: if A blocks B, neither sees the other. `private.blocked_profile_ids()` is `SECURITY DEFINER` in the `private` schema, unreachable through PostgREST, because the reciprocal half cannot be computed by a client that is only allowed to read its own blocks.
3. **Privacy** (migration 0048) — `show_activity_publicly`, which governs whether a profile's activity is visible at all.

**A block never announces itself.** There is no query the blocked party can run that separates "A blocked me" from "A has no posts". A follow refused by the block clause returns the same generic failure any other error returns. New notifications are never produced (both directions, checked at produce time under the service-role client); old ones are filtered out of the *blocker's* own list only, because deleting rows from somebody else's notifications would be a visible event on their account.

Blocking severs any follow in either direction, by trigger. Unblocking does not restore it — walking away and being willing to look again are different decisions, and the confirmation dialog says so before you tap.

---

## 4. Feeds

`/social` has four scopes: All, Following, Club mates, Rivals. Club mates and Rivals are *unavailable* rather than empty when the viewer has not named a club or a rival — nothing is queried, and the page says which of the two it is and where to fix it, instead of rendering an empty list that reads as "nobody has posted".

Paging is keyset, not offset (`created_at`, `id`). On a feed people write to continuously, offset paging repeats a card the reader already saw and drops one they will never see; a cursor cannot skip. `id` is part of the key because two posts can share a timestamp to the microsecond.

---

## 5. Trending

Real counts, in a stated window, with no score.

- **What is ranked**: Match Rooms, because `posts.fixture_id` is a real foreign key. Not topics — KIVO has no tags, and inferring a topic from post text would be an invented signal.
- **Window**: 24 hours, printed on the panel. A "trending" number with no period attached is not a claim about anything.
- **Order**: distinct participants first, volume second. One person posting forty times is exactly what a volume threshold waves through.
- **Excluded**: KIVO's own system posts, and shadow-muted authors. A busy match must not trend on KIVO talking to itself, and a muted account must not trend at all.
- **Refusal**: below three distinct participants there is no ranking. The panel prints the real totals instead — "3 match rooms have had activity, but from 2 people at most" — which is more honest than a ranking and more useful than a blank panel.

Four states, all distinct: unavailable (the query failed), empty (nothing happened), too quiet (something happened and it is not a trend), ranked. Unavailable is deliberately not the same as empty.

The ranking is platform-level; the display is viewer-level. Counts do not fold in personal blocks — a block is one reader's private decision and folding it in would make the count differ per reader — but the fixtures come back through RLS, so nothing a reader blocked ever renders.

---

## 6. Fan sentiment

Two real sources and nothing else: the `fan_ratings` people actually submitted, and the votes actually cast on that room's polls.

It returns **a number and a count, never a word**. "Positive", "mixed" and "poor" are boundaries somebody chose, and printing one hides that choice behind a label. `4.2/5 from 41 fans` is a fact the reader interprets. Below three ratings it says how few there are rather than averaging one person's mood, and zero ratings render nothing at all — a `0` would read as "everybody hated it" rather than "nobody has said".

---

## 7. Anti-abuse

- **Rate limits** on every write, enforced in Postgres so they survive an instance restart. See `API.md`.
- **Reports** carry a content snapshot, so deleting the post does not destroy the evidence.
- **Moderation** is enforced at the RLS layer, not client-side. A suspended user's client can send whatever it likes.
- **XP is bounded**: posting earns XP up to a real daily allowance (`create_post_xp`), so the reward loop cannot be farmed.
- **XP is idempotent**: every award carries a `source_key` (`post:<id>`, `prediction:<id>`), so re-running a scoring pass cannot pay twice.

---

## 8. Not built, and honest about it

- **No direct messages.** No table, no UI, and no half-built stub.
- **No quote-posts or reposts.**
- **No hashtags or topics** — which is exactly why trending ranks Rooms rather than subjects.
- **Comment threads are one level deep** in practice; the schema allows more and the UI does not.
- **No push notifications** — see `NOTIFICATIONS.md`.
