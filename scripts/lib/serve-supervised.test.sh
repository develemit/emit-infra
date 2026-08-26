#!/usr/bin/env bash
# Tests for scripts/serve-supervised.sh and scripts/lib/serve-supervised-lib.sh
# (sprint 310). Run: bash scripts/lib/serve-supervised.test.sh
set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUP="$LIB_DIR/../serve-supervised.sh"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ok   $1"; }
no() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else no "$1 (want '$3', got '$2')"; fi; }

# Poll until a predicate succeeds, up to <timeout-deciseconds> — same helper
# as hook-signals.test.sh / deploy-liveness.test.sh (docs/TEST-TIMING-PATTERNS.md).
# Reused rather than reinventing a third variant.
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

_curl_ok() { curl -fsS -o /dev/null -m 1 "$1" 2>/dev/null; }
_file_changed() { [[ -e "$1" ]] && [[ "$(cat "$1" 2>/dev/null)" != "$2" ]]; }
_line_count_at_least() { [[ -f "$1" ]] && [[ "$(wc -l < "$1" 2>/dev/null | tr -d ' ')" -ge "$2" ]]; }
_last_json_field() { python3 -c "import json,sys; print(json.loads(open(sys.argv[1]).readlines()[-1])[sys.argv[2]])" "$1" "$2" 2>/dev/null || echo MISSING; }

WORK=$(mktemp -d)
LOG_DIR="$HOME/.local/log"
NAME_PREFIX="svsuptest-$$"
cleanup() {
  pkill -f "$NAME_PREFIX" 2>/dev/null
  rm -rf "$WORK"
  rm -f "$LOG_DIR/$NAME_PREFIX"*.log
  rm -rf "$LOG_DIR/$NAME_PREFIX"*/
}
trap cleanup EXIT
cd "$WORK"

# Fixture: simulates tsx --watch. Starts a real HTTP server as a grandchild;
# on a `die` sentinel file, kills only that grandchild and idles forever
# itself — reproducing watcher-alive/zero-children after an uncaught error
# in the watched target (sprint 310's root-cause failure shape).
_write_watcher_target() {
  cat > "$1" <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
PORT="$1"
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
echo $! > server.pid
echo $$ > wrapper.pid
while true; do
  if [[ -e die ]]; then
    kill -9 "$(cat server.pid)" 2>/dev/null
    rm -f die
    while true; do sleep 3600; done
  fi
  sleep 0.2
done
EOF
  chmod +x "$1"
}

# Fixture: one brief health blip (server down ~1s, well under the default
# --failures margin used below) then back up — a single missed probe, not a
# sustained failure.
_write_flaky_target() {
  cat > "$1" <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
PORT="$1"
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
echo $! > server.pid
sleep 3
kill -9 "$(cat server.pid)" 2>/dev/null
sleep 1
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
echo $! > server.pid
wait
EOF
  chmod +x "$1"
}

echo "bash -n is clean on both files"
if bash -n "$SUP" && bash -n "$LIB_DIR/serve-supervised-lib.sh"; then
  ok "bash -n clean"
else
  no "bash -n clean"
fi

echo "watcher-alive/zero-children (the tsx --watch shape) is detected and restarted"
CASE1="$WORK/case-watcher"; mkdir -p "$CASE1"; cd "$CASE1"
_write_watcher_target "$CASE1/wrapper.sh"
PORT1=18971
NAME1="${NAME_PREFIX}-watcher"
"$SUP" --name "$NAME1" --health-url "http://127.0.0.1:$PORT1/" --dir "$CASE1" \
  --interval 1 --failures 2 --max-restarts 5 -- "$CASE1/wrapper.sh" "$PORT1" &
SUP_PID=$!
_wait_until "health endpoint to come up" 100 _curl_ok "http://127.0.0.1:$PORT1/"
_wait_until "wrapper to record its pid" 50 test -s "$CASE1/wrapper.pid"
ORIG_WRAPPER_PID=$(cat "$CASE1/wrapper.pid")
touch "$CASE1/die"
_wait_until "a death record to be appended" 150 _line_count_at_least "$CASE1/.server-deaths.jsonl" 1
_wait_until "the wrapper to restart with a new pid" 100 _file_changed "$CASE1/wrapper.pid" "$ORIG_WRAPPER_PID"
_wait_until "health endpoint to recover after restart" 100 _curl_ok "http://127.0.0.1:$PORT1/"
check "death reason is health-timeout (watcher stayed alive, only the listener died)" \
  "$(_last_json_field "$CASE1/.server-deaths.jsonl" reason)" "health-timeout"
check "death record carries the pre-restart pid" \
  "$(_last_json_field "$CASE1/.server-deaths.jsonl" pid)" "$ORIG_WRAPPER_PID"
kill -TERM "$SUP_PID" 2>/dev/null
wait "$SUP_PID" 2>/dev/null
cd "$WORK"

echo "a transient single failed probe does not trigger a restart"
CASE2="$WORK/case-flaky"; mkdir -p "$CASE2"; cd "$CASE2"
_write_flaky_target "$CASE2/flaky.sh"
PORT2=18972
NAME2="${NAME_PREFIX}-flaky"
"$SUP" --name "$NAME2" --health-url "http://127.0.0.1:$PORT2/" --dir "$CASE2" \
  --interval 1 --failures 5 --max-restarts 3 -- "$CASE2/flaky.sh" "$PORT2" &
SUP_PID=$!
_wait_until "health endpoint to come up" 100 _curl_ok "http://127.0.0.1:$PORT2/"
FIRST_SERVER_PID=$(cat "$CASE2/server.pid")
_wait_until "the flaky target to recover after its blip" 100 _file_changed "$CASE2/server.pid" "$FIRST_SERVER_PID"
_wait_until "health endpoint to answer again post-blip" 100 _curl_ok "http://127.0.0.1:$PORT2/"
if [[ -f "$CASE2/.server-deaths.jsonl" ]]; then
  no "a single-probe blip did not trigger a restart (found .server-deaths.jsonl)"
else
  ok "a single-probe blip did not trigger a restart"
fi
kill -TERM "$SUP_PID" 2>/dev/null
wait "$SUP_PID" 2>/dev/null
cd "$WORK"

echo "Ctrl-C (SIGTERM/SIGINT's sibling trap) stops the supervisor and child cleanly, records no death, does not restart"
# Exercised end-to-end with SIGTERM, not SIGINT: bash sets SIGINT to
# ignored-by-default for an async (`&`) job launched from a non-interactive
# shell, and POSIX forbids a script from overriding a signal that was
# already ignored on entry — so `kill -INT` from this test's own
# non-interactive shell wouldn't reliably reach the supervisor's own trap
# (same limitation hook-signals.test.sh documents and works around). TERM
# exercises the identical `_svsup_handle_signal` codepath; the INT-specific
# wiring is asserted separately below without going through a real kill.
CASE3="$WORK/case-sigterm"; mkdir -p "$CASE3"; cd "$CASE3"
PORT3=18973
NAME3="${NAME_PREFIX}-term"
"$SUP" --name "$NAME3" --health-url "http://127.0.0.1:$PORT3/" --dir "$CASE3" \
  --interval 1 --failures 3 --max-restarts 3 -- python3 -m http.server "$PORT3" --bind 127.0.0.1 &
SUP_PID=$!
_wait_until "health endpoint to come up" 100 _curl_ok "http://127.0.0.1:$PORT3/"
CHILD_PID=$(pgrep -f "http.server $PORT3" | head -n1)
kill -TERM "$SUP_PID"
wait "$SUP_PID" 2>/dev/null
RC=$?
check "supervisor exits 0 on a clean stop" "$RC" "0"
if [[ -n "$CHILD_PID" ]] && ! kill -0 "$CHILD_PID" 2>/dev/null; then
  ok "the child process was killed on a clean stop"
else
  no "the child process was killed on a clean stop (pid $CHILD_PID still alive)"
fi
if [[ -f "$CASE3/.server-deaths.jsonl" ]]; then
  no "no death recorded for a clean stop (file exists)"
else
  ok "no death recorded for a clean stop"
fi
cd "$WORK"

echo "SIGINT is wired to the same clean-stop handler as SIGTERM"
INT_TRAP=$( ( source "$SUP"; _svsup_install_traps; trap -p INT ) )
case "$INT_TRAP" in
  *_svsup_handle_signal*) ok "SIGINT is trapped by the same handler as SIGTERM" ;;
  *) no "SIGINT is trapped by the same handler as SIGTERM (got: '$INT_TRAP')" ;;
esac

echo "repeated start failures stop at --max-restarts with a banner, not an infinite loop"
CASE4="$WORK/case-maxrestarts"; mkdir -p "$CASE4"; cd "$CASE4"
NAME4="${NAME_PREFIX}-maxr"
OUTPUT=$("$SUP" --name "$NAME4" --health-url "http://127.0.0.1:18974/" --dir "$CASE4" \
  --interval 1 --failures 1 --max-restarts 2 -- bash -c 'exit 1' 2>&1)
RC=$?
if [[ $RC -ne 0 ]]; then ok "supervisor exits non-zero once max-restarts is hit"
else no "supervisor exits non-zero once max-restarts is hit"; fi
case "$OUTPUT" in
  *"STOPPED"*"consecutive restarts"*) ok "prints a persistent banner explaining what to do" ;;
  *) no "prints a persistent banner explaining what to do (got: $OUTPUT)" ;;
esac
check "exactly 2 death records were appended (not an infinite loop)" \
  "$(wc -l < "$CASE4/.server-deaths.jsonl" | tr -d ' ')" "2"

echo "output is mirrored to stdout and to ~/.local/log/<name>.log"
LOG4="$LOG_DIR/$NAME4.log"
if [[ -f "$LOG4" ]] && grep -q "started pid" "$LOG4"; then
  ok "log file exists and captured supervisor output"
else
  no "log file exists and captured supervisor output (checked $LOG4)"
fi
case "$OUTPUT" in
  *"started pid"*) ok "the same output also reached stdout" ;;
  *) no "the same output also reached stdout" ;;
esac

echo "each death record is one valid, complete JSON line; the file stays parseable"
ALL_VALID=1
while IFS= read -r line; do
  python3 -c "
import json, sys
r = json.loads(sys.argv[1])
required = ['ts', 'name', 'reason', 'exitCode', 'signal', 'uptimeSec', 'restartCount', 'pid', 'host', 'lastOutput']
missing = [k for k in required if k not in r]
sys.exit(1 if missing else 0)
" "$line" || ALL_VALID=0
done < "$CASE4/.server-deaths.jsonl"
if [[ "$ALL_VALID" == "1" ]]; then
  ok "every death record is valid JSON with all required fields"
else
  no "every death record is valid JSON with all required fields"
fi
cd "$WORK"

echo "log rotation caps the archive directory at the configured count"
CASE7="$WORK/case-rotate"; mkdir -p "$CASE7"; cd "$CASE7"
source "$LIB_DIR/ci-log-capture.sh"
source "$LIB_DIR/serve-supervised-lib.sh"
LOG7="$CASE7/test.log"
printf '%200s' | tr ' ' 'x' > "$LOG7"
for i in 1 2 3 4 5; do
  _svsup_rotate_log "$LOG7" 100 "$CASE7/archive" 2
  printf '%200s' | tr ' ' 'y' >> "$LOG7"
done
check "archive directory caps at max-keep" "$(ls "$CASE7/archive" | wc -l | tr -d ' ')" "2"
check "the live log file was truncated in place, not renamed away" "$([[ -f "$LOG7" ]] && echo yes || echo no)" "yes"
cd "$WORK"

echo
echo "$PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
