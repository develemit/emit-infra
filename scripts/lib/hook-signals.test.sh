#!/usr/bin/env bash
# Tests for the signal-trap helpers in ci-utils.sh (sprint 282).
# Run: bash scripts/lib/hook-signals.test.sh
set -uo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ci-utils.sh"

PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "  ok   $1"; }
no() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else no "$1 (want '$3', got '$2')"; fi; }

# Poll until a predicate succeeds, up to <timeout-deciseconds>. This exists
# instead of a fixed `sleep`: a delay that is "long enough" on an idle machine
# silently becomes a race under load. Observed 2026-08-19 — a loaded box let
# SIGTERM land before `deploy_done` had written its record, failing two
# assertions here that pass standalone. Waiting for the actual precondition
# is both faster and load-independent.
_wait_until() {
  local desc="$1" timeout_ds="$2"; shift 2
  local i=0
  while [ "$i" -lt "$timeout_ds" ]; do
    if "$@"; then return 0; fi
    sleep 0.1
    i=$((i + 1))
  done
  no "timed out after $((timeout_ds / 10))s waiting for $desc"
  return 1
}

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
git init -q .
git config user.email t@t.t && git config user.name t
git commit -q --allow-empty -m base

_json_field() { python3 -c "import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])" "$1" "$2" 2>/dev/null || echo MISSING; }
_last_history_field() { python3 -c "import json,sys; print(json.loads(open(sys.argv[1]).readlines()[-1])[sys.argv[2]])" "$1" "$2" 2>/dev/null || echo MISSING; }

# Start a fake CI/deploy phase as a real subprocess (a fresh `bash -c`, not a
# `()` subshell — bash gives a subshell the *parent's* $$, not its own, so a
# trap handler's `kill -s "$sig" "$$"` would signal the wrong process; there's
# no bash-3.2-safe fix for that inside a subshell). Sets FAKE_PID as a global,
# not via `$(...)` command substitution — capturing $! through a command
# substitution forks yet another subshell in between and loses track of the
# backgrounded job in this environment.
# The sentinel is written only after $1 has fully run, so `_wait_phase_ready`
# means exactly "the precondition this case needs is now true" — the status
# file is written AND (where $1 installs them) the traps are registered. A
# fixed sleep could land in the gap between those two, killing the process
# with the default disposition and no `interrupted` record.
_start_fake_phase() {
  rm -f phase-ready
  bash -c "
    source '$LIB'
    $1
    : > phase-ready
    sleep 30
  " &
  FAKE_PID=$!
}

_phase_ready() { [ -e phase-ready ]; }
_wait_phase_ready() { _wait_until "fake phase to become ready" 150 _phase_ready; }

echo "deploy phase killed by SIGTERM mid-build"

_start_fake_phase 'deploy_init 3; _emit_trap_signals deploy'
CHILD=$FAKE_PID
_wait_phase_ready
kill -TERM "$CHILD"
wait "$CHILD" 2>/dev/null
EXIT_CODE=$?

check "SIGTERM mid-deploy lands .deploy-status.json 'interrupted'" \
  "$(_json_field .deploy-status.json status)" "interrupted"
check "history has exactly one line" "$(wc -l < .deploy-history.jsonl | tr -d ' ')" "1"
check "history line records 'interrupted'" \
  "$(_last_history_field .deploy-history.jsonl status)" "interrupted"
check "process exits with a signal-derived status (128+15)" "$EXIT_CODE" "143"

rm -f .deploy-status.json .deploy-history.jsonl

echo "CI phase killed by SIGTERM mid-run"

_start_fake_phase 'ci_init 3; _emit_trap_signals ci'
CHILD=$FAKE_PID
_wait_phase_ready
kill -TERM "$CHILD"
wait "$CHILD" 2>/dev/null

check "SIGTERM mid-CI lands .ci-status.json 'failure'" \
  "$(_json_field .ci-status.json status)" "failure"
check "ci history has exactly one line" "$(wc -l < .ci-history.jsonl | tr -d ' ')" "1"

rm -f .ci-status.json .ci-history.jsonl

echo "signal arriving just after a normal completion"

_start_fake_phase 'deploy_init 1; _emit_trap_signals deploy; deploy_done deployed'
CHILD=$FAKE_PID
_wait_phase_ready
kill -TERM "$CHILD"
wait "$CHILD" 2>/dev/null

check "status is untouched by the late signal" \
  "$(_json_field .deploy-status.json status)" "deployed"
check "no duplicate history line from the late signal" \
  "$(wc -l < .deploy-history.jsonl | tr -d ' ')" "1"

rm -f .deploy-status.json .deploy-history.jsonl

echo "SIGHUP also lands 'interrupted'"

_start_fake_phase 'deploy_init 2; _emit_trap_signals deploy'
CHILD=$FAKE_PID
_wait_phase_ready
kill -HUP "$CHILD"
wait "$CHILD" 2>/dev/null
check "SIGHUP mid-deploy lands 'interrupted'" \
  "$(_json_field .deploy-status.json status)" "interrupted"

rm -f .deploy-status.json .deploy-history.jsonl

echo "_emit_trap_signals installs a handler for INT too"

# SIGINT can't be exercised end-to-end the way TERM/HUP are above: bash
# auto-ignores SIGINT (and SIGQUIT) for asynchronous (`&`) commands run from a
# non-interactive shell with job control off — exactly this test's own
# `_start_fake_phase` — so a real `kill -INT` here would be testing bash's
# job-control semantics, not our code. Assert the trap is registered instead,
# sourced directly (not backgrounded) so `$$`/job-control quirks don't apply.
source "$LIB"
deploy_init 1
_emit_trap_signals deploy
INT_TRAP=$(trap -p INT)
_emit_untrap_signals
_emit_stop_heartbeat deploy
case "$INT_TRAP" in
  *_emit_deploy_signal_handler*) ok "_emit_trap_signals registers an INT handler" ;;
  *) no "_emit_trap_signals registers an INT handler (got: '$INT_TRAP')" ;;
esac

rm -f .deploy-status.json .deploy-history.jsonl

echo "_emit_untrap_signals stops a later phase's writer from firing"

_start_fake_phase 'deploy_init 1; _emit_trap_signals deploy; deploy_done deployed; _emit_untrap_signals'
CHILD=$FAKE_PID
_wait_phase_ready
kill -TERM "$CHILD"
wait "$CHILD" 2>/dev/null
EXIT_CODE=$?
check "process still dies from the plain (untrapped) signal" "$EXIT_CODE" "143"
check "status file is the normal terminal value, not re-written" \
  "$(_json_field .deploy-status.json status)" "deployed"

rm -f .deploy-status.json .deploy-history.jsonl

echo
echo "$PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
