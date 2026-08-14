# KIVO — Recommendations Log

Continuously updated. Format: Category / Observation / Recommendation / Expected benefit / Effort / Priority / Status.

Status values: `Proposed`, `Accepted`, `Implemented`, `Deferred`, `Rejected`.

---

## Home Screen

1. **UX** — Competitors either pin a live-match rail permanently (feels stale off-matchday) or show a static grid (ESPN/OneFootball). **Recommendation**: build Home as a state machine — a live-match rail is the top module only when the user has a relevant live match; otherwise a "Next up" countdown module takes that slot. **Benefit**: same screen feels urgent on matchday, calm otherwise. **Effort**: Medium. **Priority**: Now. **Status**: Accepted — informs `home/page.tsx` layout.
2. **Product** — 365Scores' explicit per-team personalization builds more trust than ESPN's opaque algorithmic feed. **Recommendation**: Home is a stack of explicitly labeled, independently reorderable/hideable modules (Live Now, Your Teams, Fantasy Status, Prediction Streak, AI Insight, Discover) with sane defaults, not a black-box ranked feed. **Effort**: Medium. **Priority**: Now. **Status**: Accepted — module reordering itself deferred to post-MVP, but the labeled-module structure ships now.
3. **UI** — Full-size fantasy/prediction/XP cards on Home cause scroll fatigue before match content. **Recommendation**: collapse fantasy/prediction/XP into a single compact horizontal stat strip under the live rail. **Effort**: Low. **Priority**: Now. **Status**: Accepted.
4. **UX** — AI features bolted onto sports apps are either buried or obnoxious. **Recommendation**: one AI Copilot teaser card, single-line, expands in place on tap — never auto-expands. **Effort**: Low. **Priority**: Next (blocked on AI Copilot backend).
5. **Growth** — FotMob/Sofascore win on perceived speed via aggressive caching; critical for Nigeria's variable mobile data. **Recommendation**: cache last-known Home state client-side, render skeleton-to-real in place, never block first paint on a live fetch. **Effort**: Medium. **Priority**: Now. **Status**: Accepted as a standing engineering principle across the app, not just Home.

## Match Centre

6. **UX** — Sticky score header with in-place tab content swap (no remount/reload) is what separates Sofascore/FotMob from Flashscore/LiveScore-tier jank. **Priority**: Now (once a data provider is live). **Status**: Accepted — architecture note for when Match Centre is built.
7. **UX** — Diffed, incrementally-animated live timeline (not full re-render) is what makes FotMob's live ticker feel alive. **Priority**: Now (once live data exists). **Status**: Accepted.
8. **Social** — Every competitor buries social as a disconnected tab. **Recommendation**: persistent floating "Match Room" pill anchored to the sticky header, visible from every tab, opens as a bottom sheet over current content. **Priority**: Now — this is a core differentiator. **Status**: Accepted, design target for when Match Centre + Social are both live.
9. **Product** — AI insight should surface inline on high-signal events (goal, red card, VAR), not only live in a passive tab. **Priority**: Next.
10. **UX** — Prefetch Lineups/Stats/H2H in the background on Match Centre open so tab switches feel instant. **Priority**: Next.

## Social / Match Rooms

11. **Social** — Sofascore's social layer is a flat comment section; no competitor conveys real-time collective energy the way X/Discord do, but those are noisy/ungrounded. **Recommendation**: a real-time message-velocity "pulse" indicator at the top of the Match Room. **Effort**: Medium. **Priority**: Now. **Status**: Proposed — noted for the Match Room build (post-MVP-social-basics).
12. **Social** — Reddit threads become unreadable during goal spikes; Discord has zero structure around match events. **Recommendation**: split Match Room into an ephemeral, event-anchored "Live Reactions" lane and a persistent "Match Room Posts" feed — do not merge into one linear thread. **Effort**: High. **Priority**: Now (architecturally — the `posts`/`comments` schema already supports fixture-anchored posts; the dual-lane UI is a follow-on build). **Status**: Accepted.
13. **UX** — No competitor gives a one-tap reaction tied to a specific live event. **Recommendation**: tap a timeline event card to fire an emoji-burst reaction that joins a live-aggregated counter on that event. **Priority**: Now (post-live-data). **Status**: Proposed.
14. **Social** — Rival-fan hostility is the top complaint on Reddit/Twitter match threads. **Recommendation**: self-tag home/away/neutral on room entry, soft filter chip rather than separate walled rooms. **Priority**: Next.
15. **Growth** — Live chat evaporates after the match on every competitor. **Recommendation**: auto-generate a shareable "Room Recap" card (top reaction moment, AI one-line summary) post-match. **Priority**: Next.

## Fantasy Squad Builder

16. **Fantasy** — FPL's 2025/26 redesign is widely criticized for splitting pitch view, transfers, and player search across separate full-page views with reloads. **Recommendation**: single-screen builder — pitch view stays mounted, player search lives in a persistent bottom sheet that filters to eligible replacements on tap. **Effort**: High. **Priority**: Now, when Fantasy UI is built (schema ships first). **Status**: Accepted as the target architecture.
17. **UX** — FPL's static budget text lets users build invalid squads before discovering the error at save time. **Recommendation**: persistent live budget/formation validity bar pinned above the pitch, inline red highlight on the specific invalid slot. **Priority**: Now, with the builder.
18. **UI** — FPL's tiny captain/vice-captain tap targets are error-prone on mobile. **Recommendation**: long-press a pitch player for a radial quick-action menu (Captain/Vice/Swap/Remove). **Priority**: Next.
19. **Fantasy** — FPL users rely on third-party tools just to preview transfer point-hit math. **Recommendation**: native "planner mode" — stage hypothetical transfers, see live projected cost before confirming. **Effort**: High. **Priority**: Next — strong differentiation hook, not MVP-blocking.
20. **Product** — FPL's bench is visually secondary and a common source of auto-sub-order mistakes. **Recommendation**: bench as an equally prominent strip with drag-to-reorder and a live "would trigger" auto-sub preview. **Priority**: Later.

## Top 5 cross-surface priorities (per Agent 1)

1. Match Room dual-lane social model (#12) — the clearest differentiator nothing in the competitive set has.
2. Fantasy squad builder single-screen/bottom-sheet architecture (#16) — directly fixes FPL's most-hated recent failure.
3. Sticky Match Centre header + diffed live timeline (#6, #7) — table-stakes polish that reads as premium immediately.
4. Persistent Match Room pill visible from every Match Centre tab (#8) — cheapest way to make social ambient, not buried.
5. State-driven Home layout + explicit user-controlled modules (#1, #2) — sets the "restrained, not cluttered" tone from screen one.

---

## Brand assets

23. **UI** — The only logo source provided renders with a soft, irregular alpha gradient rather than a clean cutout (confirmed via direct pixel/histogram inspection and a failed threshold attempt) — unusable for anything but a solid dark background. **Recommendation**: request a clean-alpha or vector (SVG) export of the KIVO mark from whoever produced the original artwork, ideally including a dedicated small-size/favicon mark and a flat monochrome variant (both explicitly called for in the brand directive but not present in what was supplied). **Expected benefit**: unblocks light-background placements, app-icon generation, and any future white-label/press-kit use. **Effort**: Low (once source exists) — this is a request, not build work. **Priority**: Next. **Status**: Proposed.

---

## Architecture / Infra

21. **Backend** — Founder has $0 football-data budget currently. **Recommendation**: build the full `FootballDataProvider` abstraction now against API-Football's free tier, keep live polling feature-flagged off by default, dev-only mock adapter behind the same interface for UI work. **Status**: Accepted — see `DECISIONS.md`.
22. **Security** — Supabase RLS must authorize off `auth.jwt() ->> 'sub'` (Clerk user ID) via the native third-party integration, never the deprecated JWT-template/shared-secret approach. **Status**: Accepted, in progress.

---

*Next update expected once Agent 2 (Engineering/QA/Data) returns the schema draft and scaffold code review.*
