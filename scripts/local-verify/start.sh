#!/usr/bin/env bash
# Starts the local Supabase-shaped API in front of the verification database
# and writes the env the app needs to talk to it.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
LOG="${KIVO_LOCAL_LOG:-/tmp/kivo-shim.log}"

ps -eo pid,args | grep "[l]ocal-verify/server/index.mjs" | awk '{print $1}' | xargs -r kill || true
sleep 1
cd "$ROOT"
env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy NO_PROXY='*' \
  nohup node "$HERE/server/index.mjs" > "$LOG" 2>&1 &
for _ in $(seq 1 40); do
  grep -q "^SERVICE_KEY=" "$LOG" && break
  sleep 0.25
done
grep -q "^SERVICE_KEY=" "$LOG" || { cat "$LOG"; exit 1; }

ANON="$(grep -oP '(?<=^ANON_KEY=).*' "$LOG")"
SERVICE="$(grep -oP '(?<=^SERVICE_KEY=).*' "$LOG")"
cat > "$HERE/.env.local-verify" <<ENV
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON
SUPABASE_SERVICE_ROLE_KEY=$SERVICE
ENV
echo "shim up; env written to $HERE/.env.local-verify"
