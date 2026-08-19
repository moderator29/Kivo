#!/usr/bin/env bash
# Drops and rebuilds the local verification database from scratch:
# platform shim, then every migration in filename order, then the seed.
set -euo pipefail
DB="${KIVO_LOCAL_DB:-kivo_verify}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

psql -d postgres -v ON_ERROR_STOP=1 -q -c "drop database if exists $DB" -c "create database $DB"
# Supabase puts `extensions` on the database search_path; migration 0026 moves
# pg_trgm there and 0027 then builds a gin_trgm_ops index, which cannot resolve
# the operator class without it.
psql -d postgres -v ON_ERROR_STOP=1 -q -c "alter database $DB set search_path to \"\$user\", public, extensions"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$HERE/00_supabase_shim.sql"

for f in "$ROOT"/supabase/migrations/*.sql; do
  printf '%s ... ' "$(basename "$f")"
  if psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f" > /tmp/kivo-migration.log 2>&1; then
    echo ok
  else
    echo FAILED
    cat /tmp/kivo-migration.log
    exit 1
  fi
done
echo "--- migrations replayed ---"
