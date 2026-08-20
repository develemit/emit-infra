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

# Poll until a predicate succeeds, up to <timeout-deciseconds>. Fixed sleeps
# that are "long enough" on an idle machine become races under load — see the
# same helper in hook-signals.test.sh. Where a real timer interval is genuinely
# under test the ceiling is set well above it, so the wait stays honest while
# finishing as soon as the condition actually holds.
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

echo "deploy_init/deploy_done stamp launch mode (sprint 290)"

_launch_field() { python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['launch'][sys.argv[2]])" "$1" "$2" 2>/dev/null || echo MISSING; }

# deploy_done from the previous section already set _EMIT_DEPLOY_FINALIZED=1;
# reset it before this section's own deploy_init/deploy_done pair, same as
# the later heartbeat sections do (see their comment for why).
_EMIT_DEPLOY_FINALIZED=0
deploy_init 1 detached CLAUDECODE
check "in-flight record carries launch.mode" "$(_launch_field .deploy-status.json mode)" "detached"
check "in-flight record carries launch.marker" "$(_launch_field .deploy-status.json marker)" "CLAUDECODE"
deploy_done deployed
check "terminal record still carries launch.mode" "$(_launch_field .deploy-status.json mode)" "detached"

rm -f .deploy-status.json .deploy-history.jsonl

echo "deploy_init defaults to interactive when no launch args are given"

deploy_init 1
check "in-flight record defaults launch.mode to interactive" "$(_launch_field .deploy-status.json mode)" "interactive"

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
# system scheduling jitter can push the real first firing well past that under
# load. Poll for the actual advance with a 90s ceiling rather than sleeping a
# fixed 36s: a fixed sleep is simultaneously too slow on an idle machine and
# too short on a loaded one.
_heartbeat_advanced() {
  local now
  now=$(python3 -c "import json; print(json.load(open('.deploy-status.json'))['writer']['heartbeatAt'])" 2>/dev/null) || return 1
  [[ "$now" > "$BEFORE" ]]
}
_wait_until "the background heartbeat to advance heartbeatAt" 900 _heartbeat_advanced
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
_hb_pid_recorded() { [ -s hb_pid.txt ]; }
_wait_until "the child to record its heartbeat pid" 150 _hb_pid_recorded
HB_PID=$(cat hb_pid.txt 2>/dev/null || echo "")
if [[ -z "$HB_PID" ]]; then
  no "captured a heartbeat pid to track (got empty)"
else
  ok "captured a heartbeat pid to track"
  kill -9 "$CHILD" 2>/dev/null
  wait "$CHILD" 2>/dev/null
  # The heartbeat's own parent-liveness check runs every 5s; poll for the
  # exit with a 30s ceiling instead of assuming 8s is always enough.
  _hb_gone() { ! kill -0 "$HB_PID" 2>/dev/null; }
  _wait_until "the orphaned heartbeat to exit" 300 _hb_gone
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
