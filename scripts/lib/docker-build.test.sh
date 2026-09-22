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
echo "_build_failure_is_transient / retry"

_EMIT_BUILD_RETRY_DELAY=0

# _buildx_logged is invoked via $(...) below, which runs in a subshell — a
# plain counter variable set inside the docker() stub wouldn't survive back to
# this shell, so count calls through a file instead.
CALLS="$WORK/docker-calls"
call_count() { wc -l < "$CALLS" 2>/dev/null | tr -d ' '; }

# docker: fails with a transient message on call 1, succeeds on call 2+.
: > "$CALLS"
docker() {
  echo x >> "$CALLS"
  if [[ $(call_count) -eq 1 ]]; then
    echo "ERROR: FetchError: request to https://registry.npmjs.org failed, reason: socket hang up" >&2
    return 1
  fi
  echo "step: mock build output ($*)"
  return 0
}

_EMIT_DEPLOY_LOG_FILE="$WORK/.deploy-logs/retry1.log"
OUT=$(_buildx_logged api --platform linux/amd64 2>&1)
RC=$?
check "transient failure then success: exit 0" "$RC" "0"
check "transient failure then success: docker invoked twice" "$(call_count)" "2"
check_contains "transient failure then success: retry line printed" "$OUT" "↻ api build hit a transient network error — retrying once"
check "transient failure then success: no failure banner" \
  "$(echo "$OUT" | grep -c '✗ api build failed')" "0"

# docker: fails with a non-transient (real) error every time.
: > "$CALLS"
docker() {
  echo x >> "$CALLS"
  echo "error TS2322: Type 'string' is not assignable to type 'number'." >&2
  return 1
}

_EMIT_DEPLOY_LOG_FILE="$WORK/.deploy-logs/retry2.log"
OUT=$(_buildx_logged api --platform linux/amd64 2>&1)
RC=$?
check "non-transient failure: exit code propagates" "$RC" "1"
check "non-transient failure: docker invoked only once (no retry)" "$(call_count)" "1"
check_contains "non-transient failure: failure banner printed" "$OUT" "✗ api build failed"

# docker: fails transiently on every call — exactly one retry, then fail.
: > "$CALLS"
docker() {
  echo x >> "$CALLS"
  echo "ERROR: FetchError: socket hang up" >&2
  return 1
}

_EMIT_DEPLOY_LOG_FILE="$WORK/.deploy-logs/retry3.log"
OUT=$(_buildx_logged api --platform linux/amd64 2>&1)
RC=$?
check "transient failure twice: fails after exactly one retry" "$RC" "1"
check "transient failure twice: docker invoked exactly twice" "$(call_count)" "2"
check_contains "transient failure twice: failure banner printed" "$OUT" "✗ api build failed"

# The classifier only reads the failing attempt's output: an earlier attempt's
# transient text already sits in the log file from a prior (unrelated) call,
# and a real error on this attempt must not be masked by it.
: > "$CALLS"
docker() {
  echo x >> "$CALLS"
  echo "error TS2322: Type 'string' is not assignable to type 'number'." >&2
  return 1
}

_EMIT_DEPLOY_LOG_FILE="$WORK/.deploy-logs/retry4.log"
mkdir -p "$WORK/.deploy-logs"
echo "ERROR: FetchError: socket hang up" >> "$WORK/.deploy-logs/retry4-api.log"
OUT=$(_buildx_logged api --platform linux/amd64 2>&1)
RC=$?
check "classifier scoped to this attempt: real error not retried" "$RC" "1"
check "classifier scoped to this attempt: docker invoked only once" "$(call_count)" "1"

echo
echo "docker-build: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
