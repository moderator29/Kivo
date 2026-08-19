#!/usr/bin/env bash
# Runs the application against the local verification stack.
#
# In its own git worktree by default: another agent's dev server may already
# hold this checkout, and Next refuses two dev servers in one directory.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="${KIVO_DEV_DIR:-$(cd "$HERE/../.." && pwd)}"
PORT="${KIVO_DEV_PORT:-3100}"
LOG="${KIVO_DEV_LOG:-/tmp/kivo-dev.log}"

set -a; . "$HERE/.env.local-verify"; set +a

ps -eo pid,args | grep "[n]ext dev -p $PORT" | awk '{print $1}' | xargs -r kill || true
sleep 2
cd "$DIR"
env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy NO_PROXY='*' \
  NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  NEXT_PUBLIC_APP_URL="http://localhost:$PORT" \
  ${KIVO_DEV_API_FOOTBALL_KEY:+API_FOOTBALL_KEY="$KIVO_DEV_API_FOOTBALL_KEY"} \
  nohup npx next dev -p "$PORT" > "$LOG" 2>&1 &

for _ in $(seq 1 60); do
  grep -q "Ready in" "$LOG" 2>/dev/null && break
  sleep 1
done
tail -3 "$LOG"
