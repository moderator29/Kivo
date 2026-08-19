#!/usr/bin/env bash
# Fetches real pages from a running dev server, signed in as a scenario user,
# and reports what each one actually rendered. Server-rendered HTML is the
# subject: if a section is missing from it, it is missing from the page.
set -uo pipefail
BASE="${KIVO_DRIVE_BASE:-http://localhost:3100}"
COOKIE_FILE="${KIVO_DRIVE_COOKIE:-/tmp/ada-cookie.txt}"
COOKIES="$(cat "$COOKIE_FILE")"
OUT="${KIVO_DRIVE_OUT:-/tmp/kivo-pages}"
mkdir -p "$OUT"

fetch() {
  local label="$1" path="$2"; shift 2
  local file="$OUT/${label}.html"
  local code
  code=$(env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy NO_PROXY='*' \
    curl -s -o "$file" -w '%{http_code}' -H "Cookie: $COOKIES" "$BASE$path")
  local bytes
  bytes=$(wc -c < "$file")
  printf '%-28s %-52s %s  %6s bytes' "$label" "$path" "$code" "$bytes"
  for marker in "$@"; do
    if grep -qiF -- "$marker" "$file"; then printf '  [%s ✓]' "$marker"; else printf '  [%s ✗]' "$marker"; fi
  done
  printf '\n'
}

: "${LIVE:?set LIVE}" "${HALFTIME:?}" "${FINISHED_STATS:?}" "${FINISHED_NOEVENTS:?}" "${SCHEDULED:?}" "${CUP_NOEVENTS:?}" "${PLAYER_TWO_COMPS:?}" "${TEAM:?}" "${COMPETITION:?}"

fetch home            "/"                                            "KIVO"
fetch matches         "/matches"                                     "Harbour"
fetch match-live      "/matches/$LIVE"                               "Timeline"
fetch match-live-tl   "/matches/$LIVE?tab=timeline"                  "Timeline"
fetch match-live-stand "/matches/$LIVE?tab=standings"                "Standings"
fetch match-live-line "/matches/$LIVE?tab=lineups"                   "Lineups"
fetch match-live-heat "/matches/$LIVE?tab=heatmap"                   "Heatmap"
fetch match-live-room "/matches/$LIVE?tab=room"                      "Room"
fetch match-halftime  "/matches/$HALFTIME"                           "Half"
fetch match-finished  "/matches/$FINISHED_STATS"                     "Timeline"
fetch match-fin-heat  "/matches/$FINISHED_STATS?tab=heatmap"         "Heatmap"
fetch match-fin-line  "/matches/$FINISHED_STATS?tab=lineups"         "Lineups"
fetch match-noevents  "/matches/$FINISHED_NOEVENTS"                  "Timeline"
fetch match-cup-noev  "/matches/$CUP_NOEVENTS"                       "Timeline"
fetch match-scheduled "/matches/$SCHEDULED"                          "Preview"
fetch team            "/teams/$TEAM"                                 "Harbour Rovers"
fetch player          "/players/$PLAYER_TWO_COMPS"                   "Sandbox"
fetch competition     "/leagues/$COMPETITION"                        "Sandbox League"
fetch discover        "/discover"                                    ""
fetch fantasy         "/fantasy"                                     "Harbour Heroes"
fetch leagues         "/leagues"                                     "League"
fetch predictions     "/predictions"                                 "Prediction"
fetch social          "/social"                                      ""
fetch profile         "/profile"                                     "ada_sandbox"
fetch notifications   "/notifications"                               ""
