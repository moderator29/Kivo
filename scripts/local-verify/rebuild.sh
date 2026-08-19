#!/usr/bin/env bash
# One command from nothing to a database the product can be driven against:
# schema replayed from the migrations, seeded, and given the scenario layer.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DB="${KIVO_LOCAL_DB:-kivo_verify}"

bash "$HERE/replay.sh"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -c "set kivo.seed_confirmed = 'yes'" -f "$ROOT/supabase/seed.sql"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -c "set kivo.scenario_confirmed = 'yes'" -f "$HERE/10_scenario.sql"
