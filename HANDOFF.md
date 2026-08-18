# KIVO — Handoff

Written 2026-08-18, end of an extended multi-agent overnight build session, for whoever (human or Claude session) picks this up next. This is the entry point — it tells you what's true right now and which other document to open for depth. It does not replace `ARCHITECTURE.md`, `BUILD_STATUS.md`, `DECISIONS.md`, `ENVIRONMENT.md`, or `RECOMMENDATIONS.md` — it tells you which one to read for what.

## What KIVO is

A premium football fan platform — not a scores app. Live data + match intelligence, a native social layer (Match Rooms, posts, polls), an AI Copilot grounded only in KIVO's own verified data, fantasy, predictions (XP-based, no gambling), transfers, rewards. The full vision is `KIVO_BUILD_ACKNOWLEDGEMENT.md` — read that first if you want the original brief in the founder's own terms, not a paraphrase.

## Read this first: the one rule everything else follows from

**Zero fabricated data, ever.** Not football stats, not social proof, not user counts, not "trending," not a confidence label without a real signal behind it. Every "Coming Soon" in this product is honest — it means genuinely not built, not built-but-hidden. Every empty state that says "nothing synced yet" is telling the truth, not a bug. If you're ever tempted to fill a gap with something plausible-looking, don't — log it in `RECOMMENDATIONS.md` instead, the same way dozens of entries in that file already do ("not recommended," "not buildable without fabricating X"). This discipline is why the product is trustworthy, and it's been checked and re-checked all session — don't be the one who breaks it.

## Standing rules (non-negotiable, apply to every session, not just this one)

- **Branch discipline**: all work happens on `claude/kivo-master-build-2qijfs`. Never push to `main`.
- **No AI signatures**: no "Co-Authored-By," no model name, in any commit message.
- **Deployment is the founder's alone**: never touch Vercel config or env vars directly. Fix code; the founder deploys.
- **Legal/IP boundary**: never embed the real-athlete-photo/trademark composite image or `kivo-trophy-crown.webp` at large/legible scale in the live product — both contain baked-in trademarked league/athlete likeness. Crop-only on sliced assets, never redraw/regenerate/recolor. If a watermark or number can't be cleanly removed by cropping without cutting into real artwork, say so honestly in `RECOMMENDATIONS.md` (section 14) rather than force a bad crop.
- **Never guess on a policy question.** Admin ban semantics, quota/dedup tradeoffs for automated workers — these got explicit founder sign-off before being built (see `DECISIONS.md`'s dated entries). If you hit a decision that has real, hard-to-reverse consequences and isn't purely technical, ask, or research the actual industry-standard pattern and say plainly that's what you're doing and why — don't silently invent a policy.
- **Shared git tree discipline**: this session ran many agents concurrently against one working tree. Convention that emerged and works: `git fetch` + `git merge-base --is-ancestor origin/<branch> HEAD` before every push (never `git pull --rebase`), stage explicit paths (never `git add -A`), re-read a hot file (especially `RECOMMENDATIONS.md`) immediately before editing it since another agent may have committed since you last read it, and check `supabase/migrations/` *and* the Supabase `list_migrations` MCP tool immediately before both creating and applying a new migration — this branch had two real numbering collisions in one night before that discipline solidified.

## Working style this session established (the founder's actual preferences, not assumptions)

- Fast, parallel, non-stop. The founder wants agents genuinely running concurrently and immediately re-queued with new work the moment one finishes — not idle time waiting for explicit permission between rounds.
- The `Agent` tool (explicit-count dispatch) is the default; the `Workflow` tool is opt-in only — use it when the founder's own words ask for a workflow/orchestration/a specific agent count, or "ultracode" is explicitly on (a system reminder will say so). Don't infer opt-in from enthusiasm alone.
- Big asks arrive as long, energetic, sometimes-garbled messages covering several unrelated things at once (a bug report, a design ask, a feature build, a demand for more agents, all in one paragraph). Parse them fully before acting — don't grab the first sentence and run. Several times this session the real, high-value ask was buried mid-paragraph.
- The founder pushes back hard and specifically when something's wrong (see the "STOP BEFORE APPLYING THE TIGHTER CROP SOLUTION" correction in this session's history) — that pushback was right, and the correction is now standard practice (see asset-slicing rule above). Take founder corrections as calibration, not noise.
- Verify, then report — don't narrate intent as if it were a result. Every status update this session followed the same shape: sync git, read what actually landed, run real checks (`tsc`/`eslint`/`build`/`test`), *then* tell the founder, plainly, including the parts that didn't work or couldn't be verified. That's the standard to hold.
- When something looks broken in a screenshot, check whether it's actually a bug before "fixing" it — several reported issues this session turned out to be honest empty states (no data synced yet) rather than defects. Explain the difference; don't paper over an honest empty state to make a screenshot look better.

## Current state — the short version

Full detail lives in `BUILD_STATUS.md` (living document, keep it that way — update it as things change, don't let it drift). As of this document:

**Genuinely live and real**: auth (Clerk + Supabase native third-party JWKS integration, no JWT template), the full normalized football schema with a provider-agnostic data layer, Match Centre, Social (feed, Match Rooms — now with real-time push and system-authored goal/red-card posts, threaded comments, polls, six reaction types), Predictions with XP and a leaderboard, Fantasy (squad builder, gameweeks, leagues, roster carry-forward), AI Copilot (grounded, streaming, fact/insight distinction visible as chips) when `ANTHROPIC_API_KEY` is set, team/player/league/venue/manager pages with real head-to-head/discipline/goal-timing/transfer data, notifications (in-app, real producers on most event types), a graduated admin moderation system (`active/shadow_muted/suspended/banned`, enforced at the RLS layer, not client-trusted), an adaptive Vercel Cron live-sync worker (deployed but inert — see below), and 47 applied migrations.

**Genuinely not built, and why that's fine**: push notifications (no service worker/infra), transactional email (Resend keys reserved, unused), full i18n (English-only, no i18n library — architecture doesn't block adding one later), self-service user block/mute (distinct from admin moderation, which is real), fantasy scoring as true DB-driven config (currently versioned TS constants, which is honest and documented, not hidden).

**The two things only the founder can do, both documented in `ENVIRONMENT.md`**:
1. Add `API_FOOTBALL_KEY` and/or `ANTHROPIC_API_KEY` in Vercel and **trigger a fresh deployment** (not just save the env var — `NEXT_PUBLIC_*` values and some server config are baked in at build time; saving without redeploying is a real, previously-hit footgun). The moment these are live, sync/AI go from mock/Coming-Soon to fully real with zero further code changes — this was audited end-to-end, not assumed.
2. The Supabase↔Clerk dashboard step (`ENVIRONMENT.md`'s "One manual step only the founder can complete") — without it, every RLS-gated query is rejected regardless of what env vars are set.

Neither of these can be done from a Claude Code session — there's no key to add and no dashboard click available from here. If a session reports "APIs aren't live," this is almost always why, and the fix is on the founder's side, not a code bug to chase.

**Known open investigation**: a production screenshot showed `/social` hitting the generic error boundary for a signed-out visitor. Investigated hard this session — no bug found in the committed code, the one lead that looked promising turned out to be a dev-server cold-start artifact, not reproducible on a warm server. The Vercel account connected to this session's tools doesn't have visibility into the real KIVO project (it only sees an unrelated project), so real production logs were never actually checked. If this recurs: check the actual Vercel dashboard's runtime logs for `/social` directly, and try a fresh redeploy first (cheap, and matches the class of bug that broke sign-up earlier this session).

## What's left — where to look, not a copy of the list

`RECOMMENDATIONS.md` is the single source of truth for open work — 328 numbered items across 20 sections as of this document, actively maintained, most sections re-audited against real code (not just doc text) at least once. Do not trust an unmarked item's status without checking the code yourself first — this file has been wrong before and self-corrected each time; that's the system working, not a red flag.

Highest-leverage places to start, if you want a recommendation rather than just a pointer:
- Section 19 (`Original master-spec gap audit`) — gaps against the founder's own original brief, specifically: no real multi-provider failover (a documented, deliberate tradeoff, not an oversight — just never written to `DECISIONS.md` until this pass flagged it), no coverage registry distinguishing "provider can't support this" from "just not synced yet," AI model tiering/fallback (single model today), notification quiet-hours/timezone-awareness (blocked on a `profiles.timezone` column that doesn't exist yet).
- Section 20 (`Nested-feature sweep`) — real depth inside Settings/Profile/Match Centre/Fantasy rather than new pages. Three agents were dispatched against a chunk of this list (items 285/287/288, the fantasy-pricing/cross-link items, and 286/289/290/291/292) as this document was being written — check recent commits and section 20's RESOLVED markers before re-proposing any of it.
- Section 14 — the avatar/background asset remaster list. Real, still open: specific panels flagged with an uncroppable watermark/number that need a clean source asset, not another crop attempt.

## Verification baseline

Last full clean pass (`npx tsc --noEmit`, `npx eslint .`, `npm run build`, `npm test`) as of this document: all clean, 238 tests passed / 8 skipped (the 8 are a documented network-dependent RLS integration suite that self-skips in any sandbox without direct Postgres network access — not a real failure), 58 routes building correctly including `/api/cron/sync-live` and `/admin/moderation`. Re-run this before trusting any "done" claim, including this one, once more work has landed on top of it.
