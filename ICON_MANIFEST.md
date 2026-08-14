# KIVO Icon & Logo Manifest

Generated 2026-08-14 from four 3D icon sheets and the KIVO logo lockup in `design/raw-uploads/`. All icon assets live under `public/assets/icons/<category>/`; logo exports live under `public/brand/`.

## Summary

- **Total icons exported:** 155
- **Source sheets:** 1D873CBB (35 icons, 7×5), BF37153D (30 icons, 5×6), C3469D08 (54 icons, 9×6), C396E11A (36 icons, 7×5 with an 8-column last row)
- **Format:** WebP, quality 90, natural cropped resolution per icon (no forced uniform size, no upscaling)
- **Logo:** `public/brand/kivo-logo.webp` (quality 95) and `public/brand/kivo-logo.png` (lossless)

## (a) Alpha transparency finding

- **The four icon sheets have NO real alpha channel** (sharp reports `channels: 3, hasAlpha: false` for all of them; corner pixels are near-pure black, e.g. `RGB(1,1,8)`, `RGB(0,0,0)`). Per the brief, I did **not** attempt to fake transparency by color-keying near-black to transparent — that would have destroyed real black detail inside several icons (black football panels, black kit/jersey icons, black VAR-screen bezels, etc.). Icons are cropped tightly to their content box and the near-black sheet background is left as-is (baked-in), same as the source.
- **The logo file DOES have a real alpha channel** (`channels: 4`), but it is **not a usable cutout**: a light-background composite check (done after this agent's initial pass) showed a rough, blotchy black fringe around the whole mark, not a faint halo — the alpha data itself is a soft, irregular partial-opacity gradient baked in at generation time, and a follow-up alpha-threshold attempt still produced the same rough edge, confirming re-keying wasn't a fix. The shipped logo is therefore **flattened onto solid KIVO Obsidian (`#05060A`)** rather than exported with transparency — see the Logo exports section below for the full revision note.

## (b) Ambiguous / irregular cells and how they were resolved

- **C396E11A row 5 is 8 columns, not 7.** Rows 1–4 of this sheet are a uniform 7-column grid, but row 5 (Fan Stories, Live Audio, Podcasts, Merchandise, Offers, Rankings, Help Center, Feedback) is evenly divided into **8** columns instead. Verified directly by cropping and visually reading the row at 2× — all 8 captions are legible and evenly spaced (cell width ≈192px vs. ≈219px for rows 1–4). Handled by processing that sheet in two vertical zones (7-col zone for rows 1–4, 8-col zone for row 5) rather than forcing a uniform grid.
- **None of the four sheets use a uniform pixel grid for row *height*, only for column count.** Automated row-boundary detection (via full-width and per-column brightness-gap analysis) showed the actual icon+caption content in every sheet drifts by up to ~50px from the naive `sheetHeight / rows` division — captions frequently spill past the nominal cell boundary into what a naive crop would call "the next row." A per-column content-block walk (grouping each icon with its own caption via small internal gaps, and a documented 14% bottom-trim fallback when an icon's caption had *no* detectable gap from its pedestal) was used instead of naive grid math, and every sheet was regenerated and re-inspected as a full contact sheet until no caption text or neighboring icon bled into any crop.
- **C3469D08, rows "Birthdays" (row 4) → "Watch App" (row 5): the gap between them is only ~6–10px** (vs. ~15–25px everywhere else in that sheet), and no full-width blackout row separates them — confirmed by directly inspecting pixel brightness in that y-range (never drops below ~10-20 across any single column) and by a visual 2× crop of the region. This is a genuine tight-spacing quirk in that particular source sheet, not a detection failure. Resolved by lowering the minimum-gap tolerance to catch this small legitimate gap rather than guessing; the resulting crops were spot-checked and are clean (see `misc/birthdays.webp` and `profile-account/watch-app.webp`).
- **61 of 155 icons** (about 39%) had their icon and caption merge into a single connected content block with no detectable gap at all (varies per icon depending on pedestal height) — these are flagged `fused: true` in the underlying data and were cropped using a documented fallback (trim the bottom ~14%, minimum 14px, of the merged block) rather than a hand-tuned per-icon guess. All fused-crop outputs were included in the full contact-sheet visual review and the required spot-check; none showed caption remnants.

## (c) Caption transcription corrections

All captions were re-read directly off the sheets at 2× zoom while cropping. The provided transcription was accurate for all 155 captions across all four sheets — no corrections were needed. (The one item worth flagging: C3469D08's "Experience" icon has the glyph text "XP" baked into the 3D badge artwork itself, but the caption underneath it clearly reads "EXPERIENCE," matching the original transcription — this was double-checked closely since the two could be confused.)

## (d) Total icon count

**155 icons exported** (35 + 30 + 54 + 36, i.e. every icon on every sheet), plus the logo. Where the same caption text appears on more than one sheet, every instance was kept (they are distinct art), disambiguated as `<slug>.webp` (canonical) / `<slug>-alt-1.webp` / `<slug>-alt-2.webp`. Canonical choice rule: sheet priority order **1D873CBB > BF37153D > C3469D08 > C396E11A** (i.e. the two dedicated "nav" sheets win over the two "extended feature" sheets, and 1D873CBB wins over BF37153D as the first / primary sheet) — applied consistently rather than hand-picked per icon, since all four sheets share the same art style and render equally cleanly at small UI sizes. Exceptions/notes are called out inline in the table below where a duplicate spans a real difference in meaning (e.g. C3469D08's "Events" is a live/fan-events media icon, not a match-events-timeline icon like the other two "Events").

## Duplicate-caption groups (canonical + alternates)

| Slug family | Canonical file | Alt(s) |
|---|---|---|
| live-scores | `navigation/live-scores.webp` (1D873CBB) | `navigation/live-scores-alt-1.webp` (BF37153D) |
| fixtures | `navigation/fixtures.webp` (1D873CBB) | `navigation/fixtures-alt-1.webp` (BF37153D) |
| leagues | `navigation/leagues.webp` (1D873CBB) | `navigation/leagues-alt-1.webp` (BF37153D) |
| teams | `navigation/teams.webp` (1D873CBB) | `navigation/teams-alt-1.webp` (BF37153D) |
| players | `navigation/players.webp` (1D873CBB) | `navigation/players-alt-1.webp` (BF37153D) |
| managers | `misc/managers.webp` (1D873CBB) | `misc/managers-alt-1.webp` (BF37153D) |
| lineups | `match-centre/lineups.webp` (1D873CBB) | `match-centre/lineups-alt-1.webp` (BF37153D) |
| events | `match-centre/events.webp` (1D873CBB) | `match-centre/events-alt-1.webp` (BF37153D), `misc/events-alt-2.webp` (C3469D08) |
| predictions | `navigation/predictions.webp` (1D873CBB) | `navigation/predictions-alt-1.webp` (BF37153D) |
| fantasy | `fantasy-rewards/fantasy.webp` (1D873CBB) | `fantasy-rewards/fantasy-alt-1.webp` (BF37153D) |
| transfers | `navigation/transfers.webp` (1D873CBB) | `navigation/transfers-alt-1.webp` (BF37153D) |
| news | `navigation/news.webp` (1D873CBB) | `navigation/news-alt-1.webp` (BF37153D) |
| standings | `navigation/standings.webp` (1D873CBB) | `navigation/standings-alt-1.webp` (BF37153D) |
| notifications | `profile-account/notifications.webp` (1D873CBB) | `profile-account/notifications-alt-1.webp` (BF37153D) |
| highlights | `match-centre/highlights.webp` (1D873CBB) | `match-centre/highlights-alt-1.webp` (BF37153D), `misc/highlights-alt-2.webp` (C3469D08) |
| search | `navigation/search.webp` (1D873CBB) | `navigation/search-alt-1.webp` (BF37153D) |
| ai-copilot | `navigation/ai-copilot.webp` (1D873CBB) | `navigation/ai-copilot-alt-1.webp` (BF37153D) |
| rewards | `fantasy-rewards/rewards.webp` (1D873CBB) | `fantasy-rewards/rewards-alt-1.webp` (BF37153D) |
| settings | `profile-account/settings.webp` (1D873CBB) | `profile-account/settings-alt-1.webp` (BF37153D) |
| leaderboards | `fantasy-rewards/leaderboards.webp` (BF37153D) | `fantasy-rewards/leaderboards-alt-1.webp` (C3469D08) |
| videos | `misc/videos.webp` (BF37153D) | `misc/videos-alt-1.webp` (C3469D08) |

## Logo exports

| File | Format | Notes |
|---|---|---|
| `public/brand/kivo-logo.webp` | WebP, quality 95, 1254×1254 | Flattened onto solid `#05060A` (KIVO Obsidian) and trimmed tight to content — **not** a transparent cutout. See revision note below. |
| `public/brand/kivo-logo.png` | PNG, lossless, 1254×1254 | Same treatment, for exact-reproduction use cases (e.g. future app-icon generation). |

**Revision note (post-export review):** the first export attempted to preserve the source's real alpha channel, but that alpha data turned out to be a soft, irregular partial-opacity halo baked in at generation time — not a clean cutout. Compositing on a light background exposed it as a rough, blotchy black fringe around the whole mark, unacceptable for the primary brand asset. A second alpha-threshold attempt was tried and still showed the same rough edge, confirming the underlying alpha data itself (not a compression artifact) was the problem. The shipped version instead flattens the logo onto KIVO's own solid Obsidian background (`#05060A`) — clean and premium on KIVO's dark-first UI (which is where it's used almost everywhere), with a known, honest limitation: it will show as a dark square on a light background rather than a true cutout.

**Gap:** No separate small-size, monochrome, or true-transparent mark variant exists in the provided assets — only the full lockup (3D K-mark + KIVO wordmark + tagline + heartbeat line) was supplied, and its alpha data isn't clean enough to derive one from. A dedicated small/favicon-size mark and a flat monochrome/transparent variant need clean source art (e.g. a vector or a properly-matted PNG) from whoever produced the original — flagged in `RECOMMENDATIONS.md`, not fabricated here.

## Full icon table

### navigation (27)

| Icon | File | Sheet | Feature mapping | Usage | Size |
|---|---|---|---|---|---|
| AI Copilot *(alt)* | `navigation/ai-copilot-alt-1.webp` | BF37153D (5×6) | ai-copilot | sidebar nav — ai-copilot | 172×155 |
| AI Copilot *(canonical)* | `navigation/ai-copilot.webp` | 1D873CBB (7×5) | ai-copilot | sidebar nav — ai-copilot | 166×116 |
| AI Insights | `navigation/ai-insights.webp` | C3469D08 (9×6) | ai-copilot (insights variant) | sidebar nav — ai-copilot (insights variant) | 145×121 |
| Fixtures *(alt)* | `navigation/fixtures-alt-1.webp` | BF37153D (5×6) | fixtures | sidebar nav — fixtures | 182×156 |
| Fixtures *(canonical)* | `navigation/fixtures.webp` | 1D873CBB (7×5) | fixtures | sidebar nav — fixtures | 155×144 |
| Leagues *(alt)* | `navigation/leagues-alt-1.webp` | BF37153D (5×6) | leagues | sidebar nav — leagues | 177×157 |
| Leagues *(canonical)* | `navigation/leagues.webp` | 1D873CBB (7×5) | leagues | sidebar nav — leagues | 144×148 |
| Live Scores *(alt)* | `navigation/live-scores-alt-1.webp` | BF37153D (5×6) | live-scores | sidebar nav — live-scores | 175×147 |
| Live Scores *(canonical)* | `navigation/live-scores.webp` | 1D873CBB (7×5) | live-scores | sidebar nav — live-scores | 175×133 |
| Match Center | `navigation/match-center.webp` | BF37153D (5×6) | match-centre (hub) | sidebar nav — match-centre (hub) | 191×142 |
| Match Centre | `navigation/match-centre.webp` | 1D873CBB (7×5) | match-centre (hub) | sidebar nav — match-centre (hub) | 192×135 |
| Matches | `navigation/matches.webp` | BF37153D (5×6) | fixtures/matches | sidebar nav — fixtures/matches | 185×158 |
| News *(alt)* | `navigation/news-alt-1.webp` | BF37153D (5×6) | news | sidebar nav — news | 181×143 |
| News *(canonical)* | `navigation/news.webp` | 1D873CBB (7×5) | news | sidebar nav — news | 162×122 |
| Players *(alt)* | `navigation/players-alt-1.webp` | BF37153D (5×6) | players | sidebar nav — players | 174×149 |
| Players *(canonical)* | `navigation/players.webp` | 1D873CBB (7×5) | players | sidebar nav — players | 159×141 |
| Prediction AI | `navigation/prediction-ai.webp` | C3469D08 (9×6) | predictions (AI variant) | sidebar nav — predictions (AI variant) | 141×126 |
| Predictions *(alt)* | `navigation/predictions-alt-1.webp` | BF37153D (5×6) | predictions | sidebar nav — predictions | 169×154 |
| Predictions *(canonical)* | `navigation/predictions.webp` | 1D873CBB (7×5) | predictions | sidebar nav — predictions | 140×163 |
| Search *(alt)* | `navigation/search-alt-1.webp` | BF37153D (5×6) | search | sidebar nav — search | 174×137 |
| Search *(canonical)* | `navigation/search.webp` | 1D873CBB (7×5) | search | sidebar nav — search | 136×142 |
| Standings *(alt)* | `navigation/standings-alt-1.webp` | BF37153D (5×6) | standings | sidebar nav — standings | 159×96 |
| Standings *(canonical)* | `navigation/standings.webp` | 1D873CBB (7×5) | standings | sidebar nav — standings | 165×115 |
| Teams *(alt)* | `navigation/teams-alt-1.webp` | BF37153D (5×6) | teams | sidebar nav — teams | 154×138 |
| Teams *(canonical)* | `navigation/teams.webp` | 1D873CBB (7×5) | teams | sidebar nav — teams | 192×146 |
| Transfers *(alt)* | `navigation/transfers-alt-1.webp` | BF37153D (5×6) | transfers | sidebar nav — transfers | 182×129 |
| Transfers *(canonical)* | `navigation/transfers.webp` | 1D873CBB (7×5) | transfers | sidebar nav — transfers | 141×109 |

### match-centre (38)

| Icon | File | Sheet | Feature mapping | Usage | Size |
|---|---|---|---|---|---|
| Analysis | `match-centre/analysis.webp` | 1D873CBB (7×5) | Analysis | match centre — Analysis | 151×137 |
| Ball | `match-centre/ball.webp` | C396E11A (7×5, row5=8) | Ball | match centre — Ball | 167×171 |
| Compare | `match-centre/compare.webp` | 1D873CBB (7×5) | Compare | match centre — Compare | 147×131 |
| Corners | `match-centre/corners.webp` | C396E11A (7×5, row5=8) | Corners | match centre — Corners | 179×167 |
| Detailed Stats | `match-centre/detailed-stats.webp` | C3469D08 (9×6) | Detailed Stats | match centre — Detailed Stats | 138×131 |
| Discipline | `match-centre/discipline.webp` | C396E11A (7×5, row5=8) | Discipline | match centre — Discipline | 184×161 |
| Events *(alt)* | `match-centre/events-alt-1.webp` | BF37153D (5×6) | Events | match centre — Events | 180×132 |
| Events *(canonical)* | `match-centre/events.webp` | 1D873CBB (7×5) | Events | match centre — Events | 182×109 |
| Extra Time | `match-centre/extra-time.webp` | C396E11A (7×5, row5=8) | Extra Time | match centre — Extra Time | 162×171 |
| Formations | `match-centre/formations.webp` | C396E11A (7×5, row5=8) | Formations | match centre — Formations | 184×153 |
| Goals | `match-centre/goals.webp` | C396E11A (7×5, row5=8) | Goals | match centre — Goals | 196×172 |
| H2H | `match-centre/h2h.webp` | 1D873CBB (7×5) | H2H | match centre — H2H | 210×103 |
| Head To Head | `match-centre/head-to-head.webp` | BF37153D (5×6) | Head To Head | match centre — Head To Head | 199×135 |
| Heatmaps | `match-centre/heatmaps.webp` | 1D873CBB (7×5) | Heatmaps | match centre — Heatmaps | 196×142 |
| Highlights *(alt)* | `match-centre/highlights-alt-1.webp` | BF37153D (5×6) | Highlights | match centre — Highlights | 154×88 |
| Highlights *(canonical)* | `match-centre/highlights.webp` | 1D873CBB (7×5) | Highlights | match centre — Highlights | 147×117 |
| Injuries | `match-centre/injuries.webp` | 1D873CBB (7×5) | Injuries | match centre — Injuries | 147×146 |
| Injury Report | `match-centre/injury-report.webp` | C396E11A (7×5, row5=8) | Injury Report | match centre — Injury Report | 166×157 |
| Lineups *(alt)* | `match-centre/lineups-alt-1.webp` | BF37153D (5×6) | Lineups | match centre — Lineups | 204×134 |
| Lineups *(canonical)* | `match-centre/lineups.webp` | 1D873CBB (7×5) | Lineups | match centre — Lineups | 168×140 |
| Passing Network | `match-centre/passing-network.webp` | C396E11A (7×5, row5=8) | Passing Network | match centre — Passing Network | 172×155 |
| Player Performance | `match-centre/player-performance.webp` | C396E11A (7×5, row5=8) | Player Performance | match centre — Player Performance | 173×153 |
| Possession | `match-centre/possession.webp` | C396E11A (7×5, row5=8) | Possession | match centre — Possession | 174×165 |
| Ratings | `match-centre/ratings.webp` | C3469D08 (9×6) | Ratings | match centre — Ratings | 128×129 |
| Red Card | `match-centre/red-card.webp` | C396E11A (7×5, row5=8) | Red Card | match centre — Red Card | 166×157 |
| Referees | `match-centre/referees.webp` | C396E11A (7×5, row5=8) | Referees | match centre — Referees | 181×163 |
| Results | `match-centre/results.webp` | 1D873CBB (7×5) | Results | match centre — Results | 160×151 |
| Statistics | `match-centre/statistics.webp` | BF37153D (5×6) | Statistics | match centre — Statistics | 178×142 |
| Stats | `match-centre/stats.webp` | 1D873CBB (7×5) | Stats | match centre — Stats | 149×135 |
| Substitutions | `match-centre/substitutions.webp` | C396E11A (7×5, row5=8) | Substitutions | match centre — Substitutions | 171×156 |
| Table | `match-centre/table.webp` | BF37153D (5×6) | Table | match centre — Table | 174×142 |
| Tactical Board | `match-centre/tactical-board.webp` | C3469D08 (9×6) | Tactical Board | match centre — Tactical Board | 161×129 |
| Tactics | `match-centre/tactics.webp` | C396E11A (7×5, row5=8) | Tactics | match centre — Tactics | 178×159 |
| Top Scorers | `match-centre/top-scorers.webp` | 1D873CBB (7×5) | Top Scorers | match centre — Top Scorers | 155×144 |
| VAR | `match-centre/var.webp` | C396E11A (7×5, row5=8) | VAR | match centre — VAR | 167×159 |
| Video Review | `match-centre/video-review.webp` | C396E11A (7×5, row5=8) | Video Review | match centre — Video Review | 166×159 |
| XG | `match-centre/xg.webp` | 1D873CBB (7×5) | XG | match centre — XG | 170×155 |
| Yellow Card | `match-centre/yellow-card.webp` | C396E11A (7×5, row5=8) | Yellow Card | match centre — Yellow Card | 167×154 |

### social (9)

| Icon | File | Sheet | Feature mapping | Usage | Size |
|---|---|---|---|---|---|
| Announcements | `social/announcements.webp` | C3469D08 (9×6) | Announcements | social — Announcements | 139×123 |
| Chat Social | `social/chat-social.webp` | 1D873CBB (7×5) | chat/social | social — Chat Social | 151×112 |
| Communities | `social/communities.webp` | C3469D08 (9×6) | Communities | social — Communities | 134×125 |
| Fan Clubs | `social/fan-clubs.webp` | C3469D08 (9×6) | Fan Clubs | social — Fan Clubs | 144×117 |
| Fan Stories | `social/fan-stories.webp` | C396E11A (7×5, row5=8) | Fan Stories | social — Fan Stories | 184×171 |
| Fan Zone | `social/fan-zone.webp` | 1D873CBB (7×5) | Fan Zone | social — Fan Zone | 163×108 |
| Friends | `social/friends.webp` | C3469D08 (9×6) | Friends | social — Friends | 141×130 |
| Messages | `social/messages.webp` | C3469D08 (9×6) | Messages | social — Messages | 129×138 |
| Polls | `social/polls.webp` | 1D873CBB (7×5) | Polls | social — Polls | 138×147 |

### fantasy-rewards (15)

| Icon | File | Sheet | Feature mapping | Usage | Size |
|---|---|---|---|---|---|
| Achievements | `fantasy-rewards/achievements.webp` | C3469D08 (9×6) | Achievements | fantasy/rewards — Achievements | 140×143 |
| Challenges | `fantasy-rewards/challenges.webp` | C3469D08 (9×6) | Challenges | fantasy/rewards — Challenges | 130×144 |
| Experience | `fantasy-rewards/experience.webp` | C3469D08 (9×6) | Experience | fantasy/rewards — Experience | 135×140 |
| Fantasy *(alt)* | `fantasy-rewards/fantasy-alt-1.webp` | BF37153D (5×6) | fantasy | fantasy/rewards — Fantasy | 175×143 |
| Fantasy *(canonical)* | `fantasy-rewards/fantasy.webp` | 1D873CBB (7×5) | fantasy | fantasy/rewards — Fantasy | 170×109 |
| Gift Cards | `fantasy-rewards/gift-cards.webp` | C3469D08 (9×6) | Gift Cards | fantasy/rewards — Gift Cards | 147×121 |
| Kivo Coins | `fantasy-rewards/kivo-coins.webp` | C3469D08 (9×6) | Kivo Coins | fantasy/rewards — Kivo Coins | 149×124 |
| Leaderboards *(alt)* | `fantasy-rewards/leaderboards-alt-1.webp` | C3469D08 (9×6) | Leaderboards | fantasy/rewards — Leaderboards | 163×144 |
| Leaderboards *(canonical)* | `fantasy-rewards/leaderboards.webp` | BF37153D (5×6) | Leaderboards | fantasy/rewards — Leaderboards | 179×140 |
| My Team | `fantasy-rewards/my-team.webp` | BF37153D (5×6) | My Team | fantasy/rewards — My Team | 185×143 |
| Rankings | `fantasy-rewards/rankings.webp` | C396E11A (7×5, row5=8) | Rankings | fantasy/rewards — Rankings | 149×163 |
| Rewards *(alt)* | `fantasy-rewards/rewards-alt-1.webp` | BF37153D (5×6) | rewards | fantasy/rewards — Rewards | 149×135 |
| Rewards *(canonical)* | `fantasy-rewards/rewards.webp` | 1D873CBB (7×5) | rewards | fantasy/rewards — Rewards | 148×142 |
| Streaks | `fantasy-rewards/streaks.webp` | C3469D08 (9×6) | Streaks | fantasy/rewards — Streaks | 133×159 |
| VIP Pass | `fantasy-rewards/vip-pass.webp` | C3469D08 (9×6) | VIP Pass | fantasy/rewards — VIP Pass | 151×134 |

### profile-account (22)

| Icon | File | Sheet | Feature mapping | Usage | Size |
|---|---|---|---|---|---|
| Alerts | `profile-account/alerts.webp` | C3469D08 (9×6) | Alerts | profile/account — Alerts | 122×130 |
| Biometric | `profile-account/biometric.webp` | C3469D08 (9×6) | Biometric | profile/account — Biometric | 127×130 |
| Bookmarks | `profile-account/bookmarks.webp` | 1D873CBB (7×5) | Bookmarks | profile/account — Bookmarks | 104×116 |
| Dark Mode | `profile-account/dark-mode.webp` | C3469D08 (9×6) | Dark Mode | profile/account — Dark Mode | 132×129 |
| Downloads | `profile-account/downloads.webp` | C3469D08 (9×6) | Downloads | profile/account — Downloads | 136×127 |
| Favorites | `profile-account/favorites.webp` | BF37153D (5×6) | Favorites | profile/account — Favorites | 172×133 |
| Inbox | `profile-account/inbox.webp` | BF37153D (5×6) | Inbox | profile/account — Inbox | 190×137 |
| Language | `profile-account/language.webp` | C3469D08 (9×6) | Language | profile/account — Language | 152×116 |
| My Club | `profile-account/my-club.webp` | 1D873CBB (7×5) | My Club | profile/account — My Club | 138×149 |
| Notifications *(alt)* | `profile-account/notifications-alt-1.webp` | BF37153D (5×6) | Notifications | profile/account — Notifications | 166×135 |
| Notifications *(canonical)* | `profile-account/notifications.webp` | 1D873CBB (7×5) | Notifications | profile/account — Notifications | 129×121 |
| Privacy | `profile-account/privacy.webp` | C3469D08 (9×6) | Privacy | profile/account — Privacy | 144×127 |
| Profile | `profile-account/profile.webp` | C3469D08 (9×6) | Profile | profile/account — Profile | 133×149 |
| Push Preferences | `profile-account/push-preferences.webp` | C3469D08 (9×6) | Push Preferences | profile/account — Push Preferences | 152×129 |
| Scan QR | `profile-account/scan-qr.webp` | C3469D08 (9×6) | Scan QR | profile/account — Scan QR | 136×138 |
| Settings *(alt)* | `profile-account/settings-alt-1.webp` | BF37153D (5×6) | settings | profile/account — Settings | 151×93 |
| Settings *(canonical)* | `profile-account/settings.webp` | 1D873CBB (7×5) | settings | profile/account — Settings | 135×138 |
| Sync | `profile-account/sync.webp` | C3469D08 (9×6) | Sync | profile/account — Sync | 125×113 |
| Verification | `profile-account/verification.webp` | C3469D08 (9×6) | Verification | profile/account — Verification | 137×133 |
| Wallet | `profile-account/wallet.webp` | C3469D08 (9×6) | Wallet | profile/account — Wallet | 144×114 |
| Watch App | `profile-account/watch-app.webp` | C3469D08 (9×6) | Watch App | profile/account — Watch App | 133×135 |
| Watchlist | `profile-account/watchlist.webp` | C3469D08 (9×6) | Watchlist | profile/account — Watchlist | 155×126 |

### misc (44)

| Icon | File | Sheet | Feature mapping | Usage | Size |
|---|---|---|---|---|---|
| Academy | `misc/academy.webp` | C3469D08 (9×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 137×122 |
| Agents | `misc/agents.webp` | C396E11A (7×5, row5=8) | unmapped — spare inventory | spare — not currently mapped to a nav item | 173×142 |
| Away Travel | `misc/away-travel.webp` | C3469D08 (9×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 152×134 |
| Birthdays | `misc/birthdays.webp` | C3469D08 (9×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 155×133 |
| Calendar | `misc/calendar.webp` | C396E11A (7×5, row5=8) | unmapped — spare inventory | spare — not currently mapped to a nav item | 174×165 |
| Club History | `misc/club-history.webp` | C3469D08 (9×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 140×140 |
| Concierge | `misc/concierge.webp` | C3469D08 (9×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 144×125 |
| Contracts | `misc/contracts.webp` | C396E11A (7×5, row5=8) | unmapped — spare inventory | spare — not currently mapped to a nav item | 173×155 |
| Countries | `misc/countries.webp` | C3469D08 (9×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 138×137 |
| Donations | `misc/donations.webp` | C3469D08 (9×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 152×122 |
| Events *(alt)* | `misc/events-alt-2.webp` | C3469D08 (9×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 157×142 |
| Feature Request | `misc/feature-request.webp` | C3469D08 (9×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 153×124 |
| Feedback | `misc/feedback.webp` | C396E11A (7×5, row5=8) | unmapped — spare inventory | spare — not currently mapped to a nav item | 159×167 |
| Finances | `misc/finances.webp` | C396E11A (7×5, row5=8) | unmapped — spare inventory | spare — not currently mapped to a nav item | 175×163 |
| Fitness | `misc/fitness.webp` | C396E11A (7×5, row5=8) | unmapped — spare inventory | spare — not currently mapped to a nav item | 163×155 |
| Flights | `misc/flights.webp` | C3469D08 (9×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 159×112 |
| Galleries | `misc/galleries.webp` | C3469D08 (9×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 140×130 |
| Help Center | `misc/help-center.webp` | C396E11A (7×5, row5=8) | unmapped — spare inventory | spare — not currently mapped to a nav item | 149×158 |
| Highlights *(alt)* | `misc/highlights-alt-2.webp` | C3469D08 (9×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 139×142 |
| Hotels | `misc/hotels.webp` | C3469D08 (9×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 138×125 |
| Interviews | `misc/interviews.webp` | C3469D08 (9×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 124×138 |
| Live Audio | `misc/live-audio.webp` | C396E11A (7×5, row5=8) | unmapped — spare inventory | spare — not currently mapped to a nav item | 134×168 |
| Live Streams | `misc/live-streams.webp` | C3469D08 (9×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 134×146 |
| Managers *(alt)* | `misc/managers-alt-1.webp` | BF37153D (5×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 183×152 |
| Managers *(canonical)* | `misc/managers.webp` | 1D873CBB (7×5) | unmapped — spare inventory | spare — not currently mapped to a nav item | 144×185 |
| Market Value | `misc/market-value.webp` | C396E11A (7×5, row5=8) | unmapped — spare inventory | spare — not currently mapped to a nav item | 170×161 |
| Merchandise | `misc/merchandise.webp` | C396E11A (7×5, row5=8) | unmapped — spare inventory | spare — not currently mapped to a nav item | 153×176 |
| More | `misc/more.webp` | BF37153D (5×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 153×104 |
| Offers | `misc/offers.webp` | C396E11A (7×5, row5=8) | unmapped — spare inventory | spare — not currently mapped to a nav item | 149×177 |
| Podcasts | `misc/podcasts.webp` | C396E11A (7×5, row5=8) | unmapped — spare inventory | spare — not currently mapped to a nav item | 170×171 |
| Retro Kits | `misc/retro-kits.webp` | C3469D08 (9×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 138×141 |
| Schedule | `misc/schedule.webp` | C396E11A (7×5, row5=8) | unmapped — spare inventory | spare — not currently mapped to a nav item | 169×171 |
| Scout Report | `misc/scout-report.webp` | C396E11A (7×5, row5=8) | unmapped — spare inventory | spare — not currently mapped to a nav item | 168×158 |
| Scouting | `misc/scouting.webp` | C396E11A (7×5, row5=8) | unmapped — spare inventory | spare — not currently mapped to a nav item | 182×152 |
| Skills Training | `misc/skills-training.webp` | C3469D08 (9×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 163×115 |
| Sponsors | `misc/sponsors.webp` | C3469D08 (9×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 137×124 |
| Stadium Tour | `misc/stadium-tour.webp` | C3469D08 (9×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 149×127 |
| Stadiums | `misc/stadiums.webp` | C396E11A (7×5, row5=8) | unmapped — spare inventory | spare — not currently mapped to a nav item | 199×162 |
| Store | `misc/store.webp` | C3469D08 (9×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 143×143 |
| Tickets | `misc/tickets.webp` | C396E11A (7×5, row5=8) | unmapped — spare inventory | spare — not currently mapped to a nav item | 192×154 |
| Videos *(alt)* | `misc/videos-alt-1.webp` | C3469D08 (9×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 135×144 |
| Videos *(canonical)* | `misc/videos.webp` | BF37153D (5×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 183×135 |
| Watch Live | `misc/watch-live.webp` | 1D873CBB (7×5) | unmapped — spare inventory | spare — not currently mapped to a nav item | 152×127 |
| Wishlist | `misc/wishlist.webp` | C3469D08 (9×6) | unmapped — spare inventory | spare — not currently mapped to a nav item | 138×133 |

