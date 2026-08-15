# KIVO AI Copilot — grounding

Source: `src/lib/ai/grounding.ts` (`buildGroundingContext`). This module
already existed and already worked before this pass — this doc describes it
accurately, plus the one real enrichment added this pass (Form Engine
integration).

## How grounding works

`buildGroundingContext(profile)` runs **before** the model — deterministic
retrieval, not a tool call the model can choose to skip. It returns a
small, structured plain-text `summary` that gets injected into the system
prompt, and the system prompt (see the chat route) forbids the model from
answering specific/current football questions with anything outside that
context. This is the mechanism that keeps the Copilot from inventing
scores, fixtures, or form — it's not just prompted to be honest, it's
handed only real data to be honest *with*.

### What it grounds in, today

1. **Identity**: the signed-in user's `@username` and favourite team name,
   if set (`profiles.favourite_team_id`).
2. **Favourite team's real recent form** *(added this pass — see below)*.
3. **Follows**: every team/player/competition the user follows
   (`follows`, resolved through the same polymorphic two-step lookup
   `profile/following/page.tsx` already uses, since `followed_id` has no
   DB-level FK across three different target tables).
4. **Today's synced fixtures**: up to 30 fixtures kicking off today (UTC
   day boundary), each with real team names, competition, score (when
   known) and status. When there are none, the context explicitly tells
   the model so, and explicitly instructs it not to invent any — this is
   the load-bearing line that keeps a Copilot answer honest on a day with
   no synced data at all.
5. Nothing else. No player stats, no standings, no transfer history, no
   H2H — a question that needs any of that today gets an honest "I don't
   have that" from the model, per the system prompt's constraint, rather
   than the Copilot fabricating an answer.

## What this pass added: Form Engine enrichment

`buildGroundingContext` now also computes the user's favourite team's real
last-5 form via `computeTeamForm`/`resolveFixtureResult`
(`src/lib/football/form-engine.ts`), from the same `fixtures` table every
other football surface reads. Two honest outcomes, both surfaced to the
model as plain text:

- **Enough real finished matches synced** (`isSufficientSample`): the model
  gets the real W/D/L sequence, goals scored/conceded, and an explicit
  instruction to use it if asked about the team's form.
- **Not enough** (0 or 1 finished matches synced): the model is told
  explicitly that there's too little data for a reliable trend, and told to
  say so rather than guess — the same honesty contract every other empty
  state in KIVO follows, now extended into what the Copilot is allowed to
  claim.

This was scoped deliberately narrow: only the user's single favourite team,
not every followed team, so the extra query stays bounded to one fixture
lookup regardless of how many entities a user follows (some users follow
up to the `follows` query's own limit of 20).

## Where Form Engine could enrich this further (not done this pass)

- **Followed teams' form**, not just the favourite team — would need a
  batched `.or(home_team_id.in.(...),away_team_id.in.(...))` query across
  multiple team ids and a per-team grouping step client-side. Skipped this
  pass to keep the query surface and risk small; the favourite-team version
  above proves the pattern and is the natural template to extend.
- **Followed players' recent involvement** — "has @user's followed player
  X started their last 3 matches" — needs `lineups` joined per followed
  player id, same shape the new `players/[id]/page.tsx` "Recent form"
  section already computes for one player; extending it to N followed
  players is the same query pattern batched.
- **Match Intelligence** (H2H + form combined for a specific upcoming
  fixture the user asks about) — out of scope for this pass; would want a
  dedicated retrieval path triggered by fixture mention, not baked into
  every grounding call regardless of what's asked.

These are logged in `RECOMMENDATIONS.md` rather than built here, per this
pass's scope.
