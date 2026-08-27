#!/usr/bin/env bash
# Tests for scripts/resource-gate.sh and scripts/lib/resource-gate-lib.sh.
# Run: bash scripts/lib/resource-gate.test.sh
set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$LIB_DIR/../resource-gate.sh"
source "$LIB_DIR/resource-gate-lib.sh"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ok   $1"; }
no() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else no "$1 (want '$3', got '$2')"; fi; }

WORK=$(mktemp -d)
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

export GATE_ROOT="$WORK/gate"

echo "bash -n is clean on both files"
if bash -n "$GATE" && bash -n "$LIB_DIR/resource-gate-lib.sh"; then
  ok "bash -n clean"
else
  no "bash -n clean"
fi

echo "load classification thresholds"
check "0.5/core is ok" "$(_rgate_classify_load 8 16)" "ok"
check "2/core is busy" "$(_rgate_classify_load 32 16)" "busy"
check "3/core is critical" "$(_rgate_classify_load 48 16)" "critical"
check "zero cores does not divide by zero" "$(_rgate_classify_load 5 0)" "critical"

echo "memory pressure classification"
check "level 1 is ok" "$(_rgate_classify_pressure 1)" "ok"
check "level 2 is busy" "$(_rgate_classify_pressure 2)" "busy"
check "level 4 is critical" "$(_rgate_classify_pressure 4)" "critical"
check "unknown level is ok (probe availability is reported separately)" "$(_rgate_classify_pressure garbage)" "ok"

echo "worst-of combinator"
check "all ok" "$(_rgate_worst ok ok ok)" "ok"
check "busy beats ok" "$(_rgate_worst ok busy ok)" "busy"
check "critical beats busy" "$(_rgate_worst busy critical ok)" "critical"

echo "check exit codes follow the verdict (forced signals)"
RGATE_FORCE_LOAD=1 RGATE_FORCE_CORES=16 RGATE_FORCE_PRESSURE=1 RGATE_FORCE_HEAVY=0 "$GATE" check >/dev/null
check "calm machine exits 0" "$?" "0"
RGATE_FORCE_LOAD=32 RGATE_FORCE_CORES=16 RGATE_FORCE_PRESSURE=1 RGATE_FORCE_HEAVY=0 "$GATE" check >/dev/null
check "busy load exits 1" "$?" "1"
RGATE_FORCE_LOAD=1 RGATE_FORCE_CORES=16 RGATE_FORCE_PRESSURE=4 RGATE_FORCE_HEAVY=0 "$GATE" check >/dev/null
check "critical memory exits 2" "$?" "2"
RGATE_FORCE_LOAD=1 RGATE_FORCE_CORES=16 RGATE_FORCE_PRESSURE=1 RGATE_FORCE_HEAVY=2 "$GATE" check >/dev/null
check "two suites already running exits 1" "$?" "1"
RGATE_FORCE_LOAD=1 RGATE_FORCE_CORES=16 RGATE_FORCE_PRESSURE=1 RGATE_FORCE_HEAVY=4 "$GATE" check >/dev/null
check "four suites already running exits 2" "$?" "2"

echo "wait returns immediately on a calm machine"
RGATE_FORCE_LOAD=1 RGATE_FORCE_CORES=16 RGATE_FORCE_PRESSURE=1 RGATE_FORCE_HEAVY=0 \
  "$GATE" wait --timeout 5 --interval 1 >/dev/null 2>&1
check "wait exits 0 when calm" "$?" "0"

echo "wait gives up with the last verdict's code on timeout"
RGATE_FORCE_LOAD=1 RGATE_FORCE_CORES=16 RGATE_FORCE_PRESSURE=4 RGATE_FORCE_HEAVY=0 \
  "$GATE" wait --timeout 2 --interval 1 >/dev/null 2>&1
check "wait exits 2 when stuck critical" "$?" "2"

echo "semaphore: slots fill, overflow is refused, release frees"
DIR="$WORK/sem"
S1=$(_rgate_slot_acquire "$DIR" 2 $$)
S2=$(_rgate_slot_acquire "$DIR" 2 $$)
if [[ -n "$S1" && -n "$S2" && "$S1" != "$S2" ]]; then
  ok "two slots acquired with distinct paths"
else
  no "two slots acquired with distinct paths (got '$S1' / '$S2')"
fi
if _rgate_slot_acquire "$DIR" 2 $$ >/dev/null; then
  no "a third acquire on a 2-slot gate is refused"
else
  ok "a third acquire on a 2-slot gate is refused"
fi
_rgate_slot_release "$S1" $$
if S3=$(_rgate_slot_acquire "$DIR" 2 $$); then
  ok "released slot is acquirable again"
else
  no "released slot is acquirable again"
fi

echo "semaphore: a crashed owner's slot self-reclaims"
DIR2="$WORK/sem-stale"
sleep 30 &
DEAD_PID=$!
kill -9 "$DEAD_PID"; wait "$DEAD_PID" 2>/dev/null
mkdir -p "$DIR2"; echo "$DEAD_PID" > "$DIR2/slot-1"
if STALE=$(_rgate_slot_acquire "$DIR2" 1 $$); then
  check "dead-pid slot was reclaimed" "$(cat "$STALE")" "$$"
else
  no "dead-pid slot was reclaimed"
fi

echo "semaphore: a live owner's slot is NOT reclaimed"
DIR3="$WORK/sem-live"
sleep 60 &
LIVE_PID=$!
mkdir -p "$DIR3"; echo "$LIVE_PID" > "$DIR3/slot-1"
if _rgate_slot_acquire "$DIR3" 1 $$ >/dev/null; then
  no "live-owner slot must not be stolen"
else
  ok "live-owner slot must not be stolen"
fi
kill "$LIVE_PID" 2>/dev/null; wait "$LIVE_PID" 2>/dev/null

echo "release refuses a slot owned by someone else"
DIR4="$WORK/sem-owner"
mkdir -p "$DIR4"; echo "99999999" > "$DIR4/slot-1"
if _rgate_slot_release "$DIR4/slot-1" $$; then
  no "release of another pid's slot is refused"
else
  ok "release of another pid's slot is refused"
fi

echo "acquire CLI end-to-end: prints a path, release removes it"
# GATE_OWNER_PID pins ownership to this test shell — without it, command
# substitution's transient subshell would own (and instantly orphan) the slot.
# Real callers do the same: acquire, run, release inside one shell with
# GATE_OWNER_PID=$$.
export GATE_OWNER_PID=$$
SLOT=$(RGATE_FORCE_LOAD=1 RGATE_FORCE_CORES=16 RGATE_FORCE_PRESSURE=1 RGATE_FORCE_HEAVY=0 \
  "$GATE" acquire testtag --timeout 5 --interval 1 2>/dev/null)
if [[ -n "$SLOT" && -f "$SLOT" ]]; then
  ok "acquire printed a live slot path"
else
  no "acquire printed a live slot path (got '$SLOT')"
fi
"$GATE" release "$SLOT" 2>/dev/null
if [[ ! -f "$SLOT" ]]; then
  ok "release removed the slot file"
else
  no "release removed the slot file"
fi

echo "acquire refuses to start on a critical machine"
RGATE_FORCE_LOAD=60 RGATE_FORCE_CORES=16 RGATE_FORCE_PRESSURE=1 RGATE_FORCE_HEAVY=0 \
  "$GATE" acquire testtag --timeout 2 --interval 1 >/dev/null 2>&1
check "acquire exits 2 when the machine stays critical" "$?" "2"

echo "acquire still proceeds on a merely-busy machine (semaphore is the guard)"
SLOT=$(RGATE_FORCE_LOAD=32 RGATE_FORCE_CORES=16 RGATE_FORCE_PRESSURE=1 RGATE_FORCE_HEAVY=0 \
  "$GATE" acquire busytag --timeout 5 --interval 1 2>/dev/null)
if [[ -n "$SLOT" && -f "$SLOT" ]]; then
  ok "busy machine still grants a slot"
else
  no "busy machine still grants a slot"
fi
"$GATE" release "$SLOT" 2>/dev/null
unset GATE_OWNER_PID

echo "release refuses paths outside GATE_ROOT"
OUTSIDE="$WORK/not-a-slot"; echo "$$" > "$OUTSIDE"
if "$GATE" release "$OUTSIDE" >/dev/null 2>&1; then
  no "release outside GATE_ROOT is refused"
else
  ok "release outside GATE_ROOT is refused"
fi
[[ -f "$OUTSIDE" ]] && ok "outside file untouched" || no "outside file untouched"

echo
echo "$PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
