# KIVO Build Acknowledgement

Read in full: Master Directive, Continuation 1 (APIs/Data/AI), Continuation 2 (UX/Product/Ops), Brand Color System v2, and the Clerk+Supabase auth architecture update pasted in chat (which supersedes the "Supabase Auth" instructions inside the PDFs). This document is the required first deliverable before deep implementation.

## The vision I understood

KIVO is not a scores app. It's a football operating system: live data + match intelligence, a native social layer (match rooms, posts, polls), an AI Copilot grounded in KIVO's own verified data, fantasy, predictions, transfers, and rewards — wired together so the loop is Discover → Follow → Watch/Live → Understand → Predict → Compete → Discuss → Share → Return. Nigeria is the launch market; the architecture has to be global-shaped from day one (multi-competition, multi-timezone, multi-language-ready). Premium, restrained, "2040" product feel — not a toy, not a generic SaaS dashboard, not a gambling product.

## MVP objectives (what must be real, not mocked)

Live scores + match centre, personalized home, social layer (match rooms/posts/polls — explicitly non-optional), predictions with XP (no gambling), fantasy foundation (squad/scoring engine, provider-driven config), AI Copilot grounded in KIVO's data, team/player/league pages, transfer centre with confidence labels, notifications, shareable cards, auth, profile, responsive web (mobile-first, desktop-excellent). Everything not yet real still appears in navigation as an honest "Coming Soon" — never fake functionality.

## Technical architecture understood

Next.js App Router + TypeScript, deployed as a responsive web app architected so a native wrapper can follow later without a rewrite. Server-side data fetching/aggregation; football providers are never called directly from the browser. Provider-agnostic internal API layer sits between KIVO and any data vendor.

## Data architecture understood

KIVO owns a normalized, provider-agnostic schema (competitions → seasons → teams → players → fixtures → events → lineups → stats → standings, etc.), with `provider_mappings` translating external IDs to internal ones. Every synced record carries source, retrieved_at, freshness, and confidence. Idempotent upserts, event dedup, conflict detection, coverage registry (don't show a tab a provider doesn't actually support for that competition). No API provider is a single point of failure — primary/secondary/fallback with graceful degradation and a visible freshness indicator, never silently-stale-as-live.

## AI architecture understood

Deterministic retrieval layer first, LLM second — the model explains verified structured data, it doesn't invent it. Explicit separation of fact / calculated insight / prediction / uncertainty. Cheap model for classification/rewriting, stronger model for analysis, fallback on failure, AI outage must never break core football functionality (scores/fixtures/social stay fully usable).

## UX/UI principles understood

Dark, premium, restrained — obsidian/navy base, electric blue → cyan as primary energy, violet for AI/premium, magenta as a rare accent. Sharp controls over toy-rounded ones. Glass used selectively, not everywhere. Every feature needs loading/empty/error/partial-data/stale-data states. Motion communicates state, not decoration. Mobile is redesigned for thumbs, not a shrunk desktop. The brand doc is explicit that the palette is "a compass, not a cage" — I'm authorized to extend it when it demonstrably improves hierarchy, and expected to document why in `RECOMMENDATIONS.md` rather than drift silently.

## Social layer understood

Match Rooms attached to fixtures, posts/comments/reactions, polls (score/MOTM/ref decisions), follow graph (teams/players/competitions), personal feed, trending conversations, report/block/mute, rate limiting/anti-spam, realtime where it earns its cost (not everywhere). This is explicitly an MVP pillar, not a later phase.

## Fantasy system understood

Squad builder, formation, captain/vice-captain, bench, configurable budget, gameweeks/deadlines, private + global leagues, versioned/config-driven scoring (not hardcoded), every point traceable to verified match data, never silently computed from missing data.

## Notification system understood

Event-driven (goal, kickoff, lineups, HT/FT, red card, penalty, transfer, milestone, fantasy points, prediction result, social), per-team/player/competition preferences, quiet hours, timezone-aware, deduplicated, deep-linked, intelligently batched — not spammy.

## Admin system understood

`/admin`, fully separate from the public app, server-verified RBAC (super_admin/admin/moderator/football_data_admin/content_admin/support_admin/analyst — never a frontend-only role check), platform + provider + AI + social + fantasy health, moderation queue, audited manual data corrections, audit log on every sensitive action. Built now, not deferred — "admin is not coming soon" is explicit in the directive.

## Authentication strategy understood (per your update — this supersedes the PDF's "Supabase Auth" instruction)

**Clerk is the identity authority. Supabase is application data only.** Clerk owns signup/signin, email, X/Google/Apple, sessions, security. Supabase's native third-party auth integration (JWKS-based, trusts Clerk-issued JWTs directly — **not** the deprecated shared-secret JWT-template approach) lets Clerk session tokens authorize Postgres/Storage/Realtime. RLS policies key off `auth.jwt() ->> 'sub'` (the Clerk user ID). `profiles.clerk_user_id` is the single link between the two systems — no duplicated competing identity data. Admin auth also runs through Clerk + a KIVO role table, verified server-side.

## API strategy understood

Provider abstraction layer (`FootballDataProvider` interface) so KIVO is never hard-wired to one vendor. Sportmonks as the researched primary candidate, API-Football as a cheaper fallback candidate, Sportradar/Genius Sports as enterprise options for later — **none of this is a commitment**, it's a starting point pending an actual paid account and a licensing check, which only you can authorize (see questions below).

## 3D asset strategy understood

No 3D icon sheets have been uploaded yet in this session. When they arrive: inspect, slice individually (no distortion, no neighbor bleed, preserve transparency/resolution), consistent filenames under `/public/assets/icons/...`, and an `ICON_MANIFEST.md` mapping each icon to a feature. Used selectively (feature cards, onboarding, empty states, rewards) — not as the everywhere-icon-system; a coherent vector icon family (lucide, currently) handles compact UI controls.

## Git rules understood

Never commit to `main`. Work stays on `claude/kivo-master-build-2qijfs`. Commit identity is `moderator29` — no AI signatures, no co-author trailers, no "generated by" anywhere in commits, docs, or source. Full quality loop (lint/typecheck/build/security/secret-check) before every push.

## Agent rules understood — and one honest correction

The directive asks for exactly two persistent agents (Product/UX/Research, and Engineering/QA/Data) that never sit idle. I need to be precise about what this harness actually gives me: I don't have two standing employees I can leave running indefinitely in the background watching a queue. What I have is an `Agent` tool that spawns a task-scoped subagent, which does the work and reports back once. **I'll use it exactly the way the directive intends** — one delegate scoped to product/UX/research work, one scoped to engineering/QA/data work — dispatching real, non-trivial tasks to both continuously, in parallel, for the duration of this build. When a delegate finishes, it gets the next task immediately; nobody sits idle. I'm flagging the mechanism honestly rather than pretending it's literally two always-on hires, because that distinction affects how you should read "in progress" status between our conversation turns.

## Recommendation system understood

`RECOMMENDATIONS.md` gets created now and updated continuously — category, observation, recommendation, impact, effort, risk, status. Safe high-impact items get implemented, not just logged. Large/risky calls go in `DECISIONS.md` with rationale instead.

## Quality standards understood

No TypeScript/lint errors, no broken build, no exposed secrets, no fake data presented as live, no missing mobile layout, no unhandled empty states, no unbounded client-side API calls, RLS on everything user-owned, server-side authorization always (never trust the frontend) — and "Coming Soon" instead of fabricated functionality anywhere data or a provider isn't actually wired up yet.

## Things I believe are missing or should be improved (flagging, not deciding silently)

1. **No football data provider account exists yet.** Everything live/match-centre/transfers/news depends on this and it's a real paid commitment — needs your call (see questions).
2. **Gambling/legal posture on predictions & fantasy**: directive default is XP/streaks only, no cash prizes, no crypto — I'm treating that as decided unless you say otherwise, since building toward real-money mechanics without legal review would be an irreversible mistake to make silently.
3. **"KIVO" trademark/domain/store-name screening** hasn't happened — directive already flags this as pre-launch, provisional-name work, not a build blocker, so I'm proceeding under the working name.
4. **Push notifications (APNs/FCM) and Resend/SMTP** both need real accounts before they can do anything beyond scaffolding — not blocking the current phase, but worth surfacing now so they're not a surprise later.
5. **No 3D icon assets uploaded yet** — the icon-slicing pipeline is ready to run the moment they land.
6. **Sportmonks/API-Football current commercial redistribution terms for a fan-facing product with a social layer** haven't been verified against an actual signed contract — I can research public terms, but "does our specific use case comply" is a legal-adjacent judgment call, flagging per the directive's own rule on this.

## Quality/effort standard

Sonnet as default; medium reasoning effort for routine implementation, high effort reserved for architecture, security, data-integrity, and the major screens (Home, Match Centre, AI Copilot, Social, Fantasy, Team/Player pages, Admin dashboard) — each of those gets a critical self-review pass (hierarchy, spacing, responsiveness, accessibility, motion, brand consistency) before being called done, not accepted on the first pass.

## Post-acknowledgement update (2026-08-15)

This document is kept as-written — a record of what was understood at the start of the build — rather than edited to match later decisions. Two mentions above are now superseded: the "API strategy understood" section's framing of Sportmonks as "the researched primary candidate," and item 6's "Sportmonks/API-Football current commercial redistribution terms" flag. The founder has since explicitly decided against Sportmonks; it was removed from the codebase entirely (every reference, the schema readiness columns it was built for, and the gated stub provider seam) and replaced with a real, implemented TheSportsDB provider as the second option alongside API-Football. See `DECISIONS.md`'s 2026-08-15 "Sportmonks removed entirely" entry for the full record.
