#!/usr/bin/env bash
# Tests for scripts/lib/docker-build.sh. Run: bash scripts/lib/docker-build.test.sh
set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$LIB_DIR/docker-build.sh"

PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "  ok   $1"; }
no() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else no "$1 (want '$3', got '$2')"; fi; }
check_contains() { if [[ "$2" == *"$3"* ]]; then ok "$1"; else no "$1 ('$3' not in '$2')"; fi; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Mock docker: prints a stdout line and a stderr line, exits MOCK_RC.
docker() {
  echo "step: mock build output ($*)"
  echo "ERROR: mock failure detail" >&2
  return "${MOCK_RC:-0}"
}

echo "_buildx_logged"

# The regression this file exists for: --quiet swallowed build errors entirely.
check "no --quiet flag anywhere in buildx invocations" \
  "$(grep -v '^ *#' "$LIB_DIR/docker-build.sh" | grep -c -- '--quiet')" "0"

_EMIT_DEPLOY_LOG_FILE="$WORK/.deploy-logs/abc123.log"
mkdir -p "$WORK/.deploy-logs"

MOCK_RC=0
OUT=$(_buildx_logged web --platform linux/amd64 2>&1)
RC=$?
check "success: exit 0" "$RC" "0"
check "success: terminal output stays quiet" "$OUT" ""
check_contains "success: stdout captured in per-service log" \
  "$(cat "$WORK/.deploy-logs/abc123-web.log")" "step: mock build output"
check_contains "success: stderr captured in per-service log" \
  "$(cat "$WORK/.deploy-logs/abc123-web.log")" "ERROR: mock failure detail"
check_contains "buildx invoked with plain progress" \
  "$(cat "$WORK/.deploy-logs/abc123-web.log")" "--progress=plain"

MOCK_RC=7
OUT=$(_buildx_logged web --platform linux/amd64 2>&1)
RC=$?
check "failure: exit code propagates" "$RC" "7"
check_contains "failure: terminal names the log file" "$OUT" "abc123-web.log"
check_contains "failure: terminal shows the error tail" "$OUT" "ERROR: mock failure detail"

MOCK_RC=0
_buildx_logged web --target migrate >/dev/null 2>&1
check "second call appends (variant builds share the file)" \
  "$(grep -c 'step: mock build output' "$WORK/.deploy-logs/abc123-web.log")" "3"

_EMIT_DEPLOY_LOG_FILE=""
MOCK_RC=5
OUT=$(_buildx_logged web 2>&1)
RC=$?
check "no deploy log active: exit code propagates" "$RC" "5"
check_contains "no deploy log active: output passes through" "$OUT" "step: mock build output"

echo
echo "docker-build: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
