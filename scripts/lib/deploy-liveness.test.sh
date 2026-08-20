#!/usr/bin/env bash
# Tests for the writer/heartbeat liveness metadata in ci-utils.sh (sprint 283).
# Run: bash scripts/lib/deploy-liveness.test.sh
set -uo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ci-utils.sh"

PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "  ok   $1"; }
no() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else no "$1 (want '$3', got '$2')"; fi; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
git init -q .
git config user.email t@t.t && git config user.name t
git commit -q --allow-empty -m base

_writer_field() { python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['writer'][sys.argv[2]])" "$1" "$2" 2>/dev/null || echo MISSING; }
_has_key() { python3 -c "import json,sys; print(sys.argv[2] in json.load(open(sys.argv[1])))" "$1" "$2" 2>/dev/null || echo MISSING; }

source "$LIB"

echo "deploy_init writes a writer block for the running shell"

deploy_init 1
check "writer.pid matches \$\$" "$(_writer_field .deploy-status.json pid)" "$$"
check "writer.host key is present (value may be empty if hostname(1) fails)" \
  "$([[ "$(_writer_field .deploy-status.json host)" != "MISSING" ]] && echo yes || echo no)" "yes"
check "writer.heartbeatAt is present" \
  "$([[ -n "$(_writer_field .deploy-status.json heartbeatAt)" ]] && echo yes || echo no)" "yes"

echo "deploy_done writes a terminal record without a writer block"

deploy_done deployed
check "terminal record has no writer key" "$(_has_key .deploy-status.json writer)" "False"

rm -f .deploy-status.json .deploy-history.jsonl

echo "ci_init/ci_done mirror the same writer shape"

ci_init 1
check "ci writer.pid matches \$\$" "$(_writer_field .ci-status.json pid)" "$$"
ci_done success
check "ci terminal record has no writer key" "$(_has_key .ci-status.json writer)" "False"

rm -f .ci-status.json .ci-history.jsonl

echo "_emit_refresh_heartbeat advances heartbeatAt without touching the rest of the record"

deploy_init 1
_emit_stop_heartbeat deploy # test the refresh logic directly, not the 30s timer
BEFORE=$(python3 -c "import json; print(json.load(open('.deploy-status.json'))['writer']['heartbeatAt'])")
sleep 2.1 # ISO-8601 timestamps here are second-resolution
_emit_refresh_heartbeat .deploy-status.json
AFTER=$(python3 -c "import json; print(json.load(open('.deploy-status.json'))['writer']['heartbeatAt'])")
STEP_FIELD=$(python3 -c "import json; print(json.load(open('.deploy-status.json'))['progress']['step'])")
if [[ "$AFTER" > "$BEFORE" ]]; then
  ok "heartbeatAt advanced ($BEFORE -> $AFTER)"
else
  no "heartbeatAt advanced (want > '$BEFORE', got '$AFTER')"
fi
check "_emit_refresh_heartbeat does not touch progress fields" "$STEP_FIELD" "0"

rm -f .deploy-status.json .deploy-history.jsonl

echo "_emit_refresh_heartbeat is a no-op on a terminal record"

# ci-utils.sh guards deploy_done against double-finalization (sprint 282) via
# a module-global flag that's never meant to reset within one process's
# lifetime — a real hook run only ever calls deploy_done once. This test file
# calls deploy_init/deploy_done repeatedly in a single sourced process, so it
# has to reset the flag itself between rounds, standing in for the fresh
# process a real second deploy would run in.
_EMIT_DEPLOY_FINALIZED=0
deploy_init 1
deploy_done deployed
BEFORE_RAW=$(cat .deploy-status.json)
_emit_refresh_heartbeat .deploy-status.json
AFTER_RAW=$(cat .deploy-status.json)
check "terminal record unchanged by a stray refresh" "$AFTER_RAW" "$BEFORE_RAW"

rm -f .deploy-status.json .deploy-history.jsonl

echo "the real background timer advances heartbeatAt during a silent stretch"
echo "  (no deploy_step call in between — takes ~36s, exercising the actual 30s interval)"

deploy_init 1
BEFORE=$(python3 -c "import json; print(json.load(open('.deploy-status.json'))['writer']['heartbeatAt'])")
# The refresher's 6x(kill -0 + sleep 5) polling loop before its first refresh
# is a 30s floor, not a ceiling — process-spawn overhead per iteration and
# system scheduling jitter can push the real first firing a couple seconds
# past that under load, so give it real margin rather than sleeping exactly
# 30s and flaking on slow machines/CI.
sleep 36
AFTER=$(python3 -c "import json; print(json.load(open('.deploy-status.json'))['writer']['heartbeatAt'])")
STEP_FIELD=$(python3 -c "import json; print(json.load(open('.deploy-status.json'))['progress']['step'])")
_emit_stop_heartbeat deploy
if [[ "$AFTER" > "$BEFORE" ]]; then
  ok "background timer advanced heartbeatAt with no deploy_step calls ($BEFORE -> $AFTER)"
else
  no "background timer advanced heartbeatAt with no deploy_step calls (want > '$BEFORE', got '$AFTER')"
fi
check "progress fields still reflect deploy_init, untouched by the timer" "$STEP_FIELD" "0"

rm -f .deploy-status.json .deploy-history.jsonl

echo "no stray heartbeat process survives a kill -9 of the hook"

bash -c "
  source '$LIB'
  deploy_init 1
  echo \"\$_EMIT_DEPLOY_HEARTBEAT_PID\" > hb_pid.txt
  sleep 30
" &
CHILD=$!
sleep 0.5
HB_PID=$(cat hb_pid.txt 2>/dev/null || echo "")
if [[ -z "$HB_PID" ]]; then
  no "captured a heartbeat pid to track (got empty)"
else
  ok "captured a heartbeat pid to track"
  kill -9 "$CHILD" 2>/dev/null
  wait "$CHILD" 2>/dev/null
  sleep 8 # heartbeat's own parent-liveness check runs every 5s
  if kill -0 "$HB_PID" 2>/dev/null; then
    no "heartbeat process exited after its parent was kill -9'd"
  else
    ok "heartbeat process exited after its parent was kill -9'd"
  fi
fi

rm -f hb_pid.txt .deploy-status.json .deploy-history.jsonl

echo
echo "$PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
