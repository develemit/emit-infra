#!/usr/bin/env bash
# Tests for scripts/gated-run.sh.
# Run: bash scripts/lib/gated-run.test.sh
set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$LIB_DIR/../gated-run.sh"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ok   $1"; }
no() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else no "$1 (want '$3', got '$2')"; fi; }

WORK=$(mktemp -d)
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# A calm, deterministic machine so acquire never waits.
export GATE_ROOT="$WORK/gate" RGATE_FORCE_LOAD=0.1 RGATE_FORCE_CORES=16 RGATE_FORCE_PRESSURE=1 RGATE_FORCE_HEAVY=0
unset RESOURCE_GATE_SUITE_HELD VITEST_MAX_WORKERS

held() { ls "$GATE_ROOT/suite" 2>/dev/null | grep -c '^slot-' || true; }

echo "bash -n is clean"
if bash -n "$RUNNER"; then ok "bash -n clean"; else no "bash -n clean"; fi

echo "no command is a usage error"
bash "$RUNNER" >/dev/null 2>&1
check "exit code" "$?" "2"

echo "exit code passes through"
bash "$RUNNER" "exit 3" 2>/dev/null
check "exit code" "$?" "3"

echo "a slot is held while the command runs, released after"
during=$(GATE_ROOT="$GATE_ROOT" bash "$RUNNER" "ls \"$GATE_ROOT/suite\" | grep -c '^slot-'" 2>/dev/null)
check "held during run" "$during" "1"
check "released after" "$(held)" "0"

echo "compound commands run via bash -c"
check "compound" "$(bash "$RUNNER" "echo a && echo b" 2>/dev/null | tr '\n' ' ')" "a b "

echo "the child sees the held marker and the vitest cap"
check "held marker" "$(bash "$RUNNER" 'echo $RESOURCE_GATE_SUITE_HELD' 2>/dev/null)" "1"
check "vitest cap default" "$(bash "$RUNNER" 'echo $VITEST_MAX_WORKERS' 2>/dev/null)" "3"
check "vitest cap respects export" "$(VITEST_MAX_WORKERS=6 bash "$RUNNER" 'echo $VITEST_MAX_WORKERS' 2>/dev/null)" "6"

echo "nested calls don't take a second slot"
nested=$(bash "$RUNNER" "bash \"$RUNNER\" \"ls '$GATE_ROOT/suite' | grep -c '^slot-'\"" 2>/dev/null)
check "one slot while nested" "$nested" "1"

echo "missing gate script runs ungated"
check "ungated" "$(GATED_RUN_GATE="$WORK/nope.sh" bash "$RUNNER" "echo ran" 2>/dev/null)" "ran"

echo
echo "gated-run: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
