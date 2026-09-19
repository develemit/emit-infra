#!/usr/bin/env bash
# Tests for the secret-scan wiring in ci-utils.sh. Run: bash scripts/lib/ci-utils.test.sh
# The scan itself is covered by log-secret-scan.test.sh; this proves ci_done and
# deploy_done actually call it and propagate its exit code.
set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$LIB_DIR/ci-utils.sh"

PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "  ok   $1"; }
no() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else no "$1 (want '$3', got '$2')"; fi; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

# Fixture-only fake token — never a real credential.
FAKE_TOKEN="gho_$(printf 'x%.0s' $(seq 1 36))"

reset_state() {
  _EMIT_CI_FINALIZED=0
  _EMIT_DEPLOY_FINALIZED=0
  _EMIT_SHA=fakesha
  _EMIT_BRANCH=main
  _EMIT_STARTED=2026-01-01T00:00:00Z
  _EMIT_STARTED_EPOCH=$(date +%s)
  _EMIT_LOG_FILE=""
  _EMIT_DEPLOY_LOG_FILE=""
}

echo "ci_done secret-scan wiring"

reset_state
printf 'all good\n' > clean-ci.log
_EMIT_LOG_FILE="$PWD/clean-ci.log"
ci_done success >/dev/null 2>&1; check "ci_done returns 0 for a clean log" "$?" "0"

reset_state
printf 'echo %s | docker login\n' "$FAKE_TOKEN" > dirty-ci.log
_EMIT_LOG_FILE="$PWD/dirty-ci.log"
ci_done success >/dev/null 2>&1; RC=$?
if [[ $RC -ne 0 ]]; then ok "ci_done returns non-zero when the log holds a token"; else no "ci_done returns non-zero when the log holds a token"; fi

echo "deploy_done secret-scan wiring"

reset_state
printf 'all good\n' > clean-deploy.log
_EMIT_DEPLOY_LOG_FILE="$PWD/clean-deploy.log"
deploy_done deployed >/dev/null 2>&1; check "deploy_done returns 0 for a clean log" "$?" "0"

reset_state
printf 'echo %s | docker login\n' "$FAKE_TOKEN" > dirty-deploy.log
_EMIT_DEPLOY_LOG_FILE="$PWD/dirty-deploy.log"
deploy_done deployed >/dev/null 2>&1; RC=$?
if [[ $RC -ne 0 ]]; then ok "deploy_done returns non-zero when the log holds a token"; else no "deploy_done returns non-zero when the log holds a token"; fi

echo
echo "$PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
