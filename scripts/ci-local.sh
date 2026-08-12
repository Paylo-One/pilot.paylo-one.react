#!/usr/bin/env bash
#
# ci-local.sh — run the CI pipeline locally, including the Postgres-backed
# tenant-isolation test, before pushing. Mirrors .github/workflows/ci.yml.
#
# Requirements: Docker running + the Supabase CLI installed
# (`brew install supabase/tap/supabase`).
#
# Usage:
#   npm run ci:local            # full pipeline (quality + DB integration)
#   KEEP_SUPABASE=1 npm run ci:local   # leave the stack running afterwards
#
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> quality: lint"
npm run lint
echo "==> quality: typecheck"
npm run typecheck
echo "==> quality: open-source hygiene"
npm run check:oss
echo "==> quality: unit tests (integration self-skips without DB env)"
npm test
echo "==> quality: dependency audit (high/critical)"
npx audit-ci --config ./audit-ci.jsonc

# --- Postgres-backed tenant-isolation -------------------------------------
STARTED_HERE=0
if ! supabase status >/dev/null 2>&1; then
  echo "==> starting Supabase local stack (this pulls images on first run)"
  supabase start
  STARTED_HERE=1
else
  echo "==> reusing already-running Supabase stack"
fi

# Map the CLI's env output to the names the integration test expects.
eval "$(supabase status -o env)"
export SUPABASE_TEST_URL="${API_URL}"
export SUPABASE_TEST_ANON_KEY="${ANON_KEY}"
export SUPABASE_TEST_SERVICE_KEY="${SERVICE_ROLE_KEY}"

echo "==> runtime tenant-isolation test (real RLS on Postgres)"
set +e
npm run test:integration
RESULT=$?
set -e

if [[ "${KEEP_SUPABASE:-0}" != "1" && "${STARTED_HERE}" == "1" ]]; then
  echo "==> stopping Supabase stack (set KEEP_SUPABASE=1 to keep it running)"
  supabase stop >/dev/null 2>&1 || true
fi

if [[ "${RESULT}" -ne 0 ]]; then
  echo "✗ ci-local failed"
  exit "${RESULT}"
fi
echo "✓ ci-local passed"
