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

echo "Ctrl-C (SIGTERM/SIGINT's sibling trap) stops the supervisor and child cleanly, does not restart, and records exactly one 'signalled' death (sprint 321)"
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
check "exactly one death record was appended for the signal (no duplicates across the three SHUTTING_DOWN guards)" \
  "$(wc -l < "$CASE3/.server-deaths.jsonl" 2>/dev/null | tr -d ' ')" "1"
check "the signalled death's reason is 'signalled'" \
  "$(_last_json_field "$CASE3/.server-deaths.jsonl" reason)" "signalled"
check "the signalled death's signal is TERM" \
  "$(_last_json_field "$CASE3/.server-deaths.jsonl" signal)" "TERM"
check "the supervisor did not restart after the signal (restartCount stayed 0)" \
  "$(_last_json_field "$CASE3/.server-deaths.jsonl" restartCount)" "0"
cd "$WORK"

echo "start_epoch/CHILD_ACTIVE are pre-initialized globals, so a signal before the first child ever spawns can't trip 'set -u'"
# Mirrors the INT-wiring test below: sourcing without running main() lets us
# inspect state a real `kill -TERM` race against the first spawn can't
# reliably reproduce (same rationale as the INT test's own comment).
INIT_STATE=$( ( source "$SUP"; echo "$start_epoch $CHILD_ACTIVE" ) )
check "start_epoch and CHILD_ACTIVE start at 0 before any child spawns" "$INIT_STATE" "0 0"

echo "_svsup_append_death writes valid JSON even when signalContext contains quotes and newlines (sprint 321)"
CASE3B="$WORK/case-signalcontext-json"; mkdir -p "$CASE3B"; cd "$CASE3B"
source "$LIB_DIR/serve-supervised-lib.sh"
echo "some log output" > fake.log
NASTY_CONTEXT=$'1234 1 "quoted \'sender\'"\nmultiline "tail"'
_svsup_append_death "$CASE3B/.server-deaths.jsonl" "$NAME_PREFIX-ctxtest" "signalled" "" "TERM" \
  0 0 "" "" "$CASE3B/fake.log" "$NASTY_CONTEXT"
# Passed as argv, not interpolated into python source — same reasoning as
# _svsup_append_death itself uses python3's json.dumps instead of printf.
if python3 -c "
import json, sys
path, expected = sys.argv[1], sys.argv[2]
r = json.loads(open(path).readlines()[-1])
sys.exit(0 if r.get('reason') == 'signalled' and r.get('signalContext') == expected else 1)
" "$CASE3B/.server-deaths.jsonl" "$NASTY_CONTEXT"; then
  ok "a signalContext with quotes and newlines round-trips as valid JSON"
else
  no "a signalContext with quotes and newlines round-trips as valid JSON"
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

echo "a fresh hold file defers a health-timeout restart; a stale one lets it through"
CASE5="$WORK/case-hold"; mkdir -p "$CASE5"; cd "$CASE5"
PORT5=18975
NAME5="${NAME_PREFIX}-hold"
# Target never answers on $PORT5 at all, so every probe fails from the start —
# the only thing standing between it and a restart is the hold file.
"$SUP" --name "$NAME5" --health-url "http://127.0.0.1:$PORT5/" --dir "$CASE5" \
  --interval 1 --failures 2 --max-restarts 2 \
  --hold-file hold --hold-stale 3 --hold-max 600 -- bash -c 'while true; do sleep 3600; done' &
SUP_PID=$!
# Keep the hold fresh for well past --interval * --failures.
for _ in 1 2 3 4 5 6 7 8; do touch "$CASE5/hold"; sleep 0.5; done
if [[ -f "$CASE5/.server-deaths.jsonl" ]]; then
  no "a fresh hold file defers the restart (death recorded anyway)"
else
  ok "a fresh hold file defers the restart"
fi
# Stop refreshing: the hold goes stale after --hold-stale and the kill lands.
_wait_until "the restart to land once the hold goes stale" 200 \
  _line_count_at_least "$CASE5/.server-deaths.jsonl" 1
check "the deferred death is still recorded as health-timeout" \
  "$(_last_json_field "$CASE5/.server-deaths.jsonl" reason)" "health-timeout"
kill -TERM "$SUP_PID" 2>/dev/null
wait "$SUP_PID" 2>/dev/null
cd "$WORK"

echo "--hold-max bounds the deferral so a wedged server still restarts"
CASE6="$WORK/case-holdmax"; mkdir -p "$CASE6"; cd "$CASE6"
PORT6=18976
NAME6="${NAME_PREFIX}-holdmax"
"$SUP" --name "$NAME6" --health-url "http://127.0.0.1:$PORT6/" --dir "$CASE6" \
  --interval 1 --failures 2 --max-restarts 2 \
  --hold-file hold --hold-stale 30 --hold-max 3 -- bash -c 'while true; do sleep 3600; done' &
SUP_PID=$!
# Refresh forever — only --hold-max can end this deferral.
( for _ in $(seq 1 60); do touch "$CASE6/hold"; sleep 0.5; done ) &
TOUCHER=$!
_wait_until "--hold-max to expire and force the restart" 200 \
  _line_count_at_least "$CASE6/.server-deaths.jsonl" 1
ok "--hold-max forces a restart even while the hold file stays fresh"
kill "$TOUCHER" 2>/dev/null
kill -TERM "$SUP_PID" 2>/dev/null
wait "$SUP_PID" 2>/dev/null
cd "$WORK"

echo "a reparented grandchild holding the port is reaped instead of blocking the restart"
CASE8="$WORK/case-orphan"; mkdir -p "$CASE8"; cd "$CASE8"
source "$LIB_DIR/serve-supervised-lib.sh"
PORT8=18978
python3 -m http.server "$PORT8" --bind 127.0.0.1 >/dev/null 2>&1 &
ORPHAN=$!
_wait_until "the orphan listener to come up" 100 _curl_ok "http://127.0.0.1:$PORT8/"
_svsup_wait_port_free 127.0.0.1 "$PORT8" 5 && no "fixture check: port should read as busy"
_svsup_kill_port_holders 127.0.0.1 "$PORT8" >/dev/null
if _wait_until "the port to free up after killing the holder" 100 \
     _svsup_wait_port_free 127.0.0.1 "$PORT8" 2; then
  ok "_svsup_kill_port_holders frees a port held by a process we do not own"
fi
kill -9 "$ORPHAN" 2>/dev/null
wait "$ORPHAN" 2>/dev/null
cd "$WORK"

echo "_svsup_cmdline_matches_command: token 0 always counts, later tokens only if long enough and not a bare flag"
source "$LIB_DIR/serve-supervised-lib.sh"
if _svsup_cmdline_matches_command "python3 -m http.server 18980 --bind 127.0.0.1" "python3" "-m" "http.server" "18980" "--bind" "127.0.0.1"; then
  ok "matches when token 0 (the interpreter) is a substring of the holder's cmdline"
else
  no "matches when token 0 (the interpreter) is a substring of the holder's cmdline"
fi
if _svsup_cmdline_matches_command "node .../tsx/dist/loader.mjs apps/api/src/index.ts" "tsx" "--env-file=apps/api/.env" "--watch" "apps/api/src/index.ts"; then
  ok "matches on a distinctive later token (the entry-point path) even when token 0 differs (tsx's own real worker is node, not tsx)"
else
  no "matches on a distinctive later token (the entry-point path) even when token 0 differs"
fi
if _svsup_cmdline_matches_command "python3 -m http.server 18980 --bind 127.0.0.1" "bash" "-c" "sleep 3600"; then
  no "refuses a holder whose cmdline shares nothing with the supervised command"
else
  ok "refuses a holder whose cmdline shares nothing with the supervised command"
fi
if _svsup_cmdline_matches_command "some-totally-different-daemon -w -c" "startup-cmd" "-w" "-c"; then
  no "a bare short flag alone ('-w'/'-c') is not enough to count as a match"
else
  ok "a bare short flag alone ('-w'/'-c') is not enough to count as a match"
fi

echo "a pre-held port whose holder's command line matches the supervised command is reclaimed, and the new child starts cleanly"
CASE11="$WORK/case-reclaim-match"; mkdir -p "$CASE11"; cd "$CASE11"
PORT11=18981
NAME11="${NAME_PREFIX}-reclaim-match"
# Simulates the SIGKILL scenario directly: an orphan left over from a prior
# supervisor instance, running the exact same command this new instance is
# about to (re)launch, still bound to the health port before this supervisor
# has spawned anything of its own.
python3 -m http.server "$PORT11" --bind 127.0.0.1 >/dev/null 2>&1 &
ORPHAN11=$!
_wait_until "the orphan to come up" 100 _curl_ok "http://127.0.0.1:$PORT11/"
"$SUP" --name "$NAME11" --health-url "http://127.0.0.1:$PORT11/" --dir "$CASE11" \
  --interval 1 --failures 3 --max-restarts 2 \
  -- python3 -m http.server "$PORT11" --bind 127.0.0.1 &
SUP_PID=$!
if _wait_until "the orphan to be reclaimed (killed)" 100 bash -c "! kill -0 $ORPHAN11 2>/dev/null"; then
  ok "the matching orphan was killed by the pre-spawn reclaim"
else
  no "the matching orphan was killed by the pre-spawn reclaim"
fi
if _wait_until "the health endpoint to come back up under the new child" 100 _curl_ok "http://127.0.0.1:$PORT11/"; then
  ok "the supervisor's own child started cleanly after reclaiming the port"
else
  no "the supervisor's own child started cleanly after reclaiming the port"
fi
kill -TERM "$SUP_PID" 2>/dev/null
wait "$SUP_PID" 2>/dev/null
wait "$ORPHAN11" 2>/dev/null
cd "$WORK"

echo "a pre-held port whose holder's command line does not match the supervised command is refused, not killed, and the supervisor fails fast"
CASE12="$WORK/case-reclaim-refuse"; mkdir -p "$CASE12"; cd "$CASE12"
PORT12=18982
NAME12="${NAME_PREFIX}-reclaim-refuse"
python3 -m http.server "$PORT12" --bind 127.0.0.1 >/dev/null 2>&1 &
UNRELATED12=$!
_wait_until "the unrelated listener to come up" 100 _curl_ok "http://127.0.0.1:$PORT12/"
OUTPUT12=$("$SUP" --name "$NAME12" --health-url "http://127.0.0.1:$PORT12/" --dir "$CASE12" \
  --interval 1 --failures 3 --max-restarts 2 \
  -- bash -c 'sleep 3600' 2>&1)
RC12=$?
if [[ $RC12 -ne 0 ]]; then
  ok "the supervisor exits non-zero rather than starting on top of an unrecognized holder"
else
  no "the supervisor exits non-zero rather than starting on top of an unrecognized holder"
fi
case "$OUTPUT12" in
  *"refusing to kill"*"refusing to start on top of it"*) ok "logs a loud refusal naming the holder, not a silent no-op" ;;
  *) no "logs a loud refusal naming the holder, not a silent no-op (got: $OUTPUT12)" ;;
esac
if kill -0 "$UNRELATED12" 2>/dev/null; then
  ok "the unrelated holder was left running, not killed"
else
  no "the unrelated holder was left running, not killed"
fi
kill -9 "$UNRELATED12" 2>/dev/null
wait "$UNRELATED12" 2>/dev/null
cd "$WORK"

echo "the EXIT trap kills the child tree on an unplanned exit"
CASE13="$WORK/case-exittrap"; mkdir -p "$CASE13"; cd "$CASE13"
# A real fixture child + grandchild, so this proves the whole tree dies (the
# same _svsup_kill_tree the death path uses), not just the top pid.
cat > tree13.sh <<'EOF'
#!/usr/bin/env bash
sleep 3600 &
echo $! > descendant.pid
while true; do sleep 1; done
EOF
chmod +x tree13.sh
./tree13.sh &
FAKE_CHILD=$!
_wait_until "the fixture descendant to register" 50 test -s "$CASE13/descendant.pid"
FAKE_DESC=$(cat "$CASE13/descendant.pid")
( source "$SUP"; NAME="exittrap-abnormal"; CHILD_PID=$FAKE_CHILD; CHILD_ACTIVE=1; SHUTTING_DOWN=0; _svsup_handle_exit )
if _wait_until "the fixture child and descendant to both die" 50 \
     bash -c "! kill -0 $FAKE_CHILD 2>/dev/null && ! kill -0 $FAKE_DESC 2>/dev/null"; then
  ok "the EXIT trap kills the whole child tree on an unplanned exit"
else
  no "the EXIT trap kills the whole child tree on an unplanned exit"
fi
kill -9 "$FAKE_CHILD" "$FAKE_DESC" 2>/dev/null
cd "$WORK"

echo "the EXIT trap is a no-op once SHUTTING_DOWN is set — the signal handler already tore the tree down itself, so this must not double-kill"
CASE14="$WORK/case-exittrap-noop"; mkdir -p "$CASE14"; cd "$CASE14"
cp "$CASE13/tree13.sh" tree14.sh
./tree14.sh &
FAKE_CHILD2=$!
_wait_until "the fixture descendant to register" 50 test -s "$CASE14/descendant.pid"
FAKE_DESC2=$(cat "$CASE14/descendant.pid")
( source "$SUP"; NAME="exittrap-shutdown"; CHILD_PID=$FAKE_CHILD2; CHILD_ACTIVE=1; SHUTTING_DOWN=1; _svsup_handle_exit )
sleep 0.3
if kill -0 "$FAKE_CHILD2" 2>/dev/null && kill -0 "$FAKE_DESC2" 2>/dev/null; then
  ok "the EXIT trap left the tree alone when SHUTTING_DOWN was already set"
else
  no "the EXIT trap left the tree alone when SHUTTING_DOWN was already set"
fi
kill -9 "$FAKE_CHILD2" "$FAKE_DESC2" 2>/dev/null
cd "$WORK"

echo "_svsup_wait_pids_gone waits on descendants, not just the root"
CASE9="$WORK/case-treewait"; mkdir -p "$CASE9"; cd "$CASE9"
# A trailing `while` loop, not a bare `sleep`: bash exec-optimises the last
# simple command of `-c`, which would replace the parent and reparent the
# background child to pid 1 before the test even starts.
cat > tree.sh <<'EOF'
#!/usr/bin/env bash
sleep 3600 &
echo $! > descendant.pid
while true; do sleep 1; done
EOF
chmod +x tree.sh
./tree.sh &
ROOT=$!
_wait_until "the fixture descendant to register" 50 test -s "$CASE9/descendant.pid"
DESCENDANT=$(cat "$CASE9/descendant.pid")
TREE=$(_svsup_tree_pids "$ROOT")
case " $(echo $TREE) " in
  *" $DESCENDANT "*) ok "_svsup_tree_pids includes the descendant" ;;
  *) no "_svsup_tree_pids includes the descendant (root $ROOT, want $DESCENDANT, got: $(echo $TREE))" ;;
esac
# Kill only the root. Its child survives and reparents to pid 1 — exactly the
# orphan that used to keep holding the port after a "successful" teardown.
kill -9 "$ROOT" 2>/dev/null; wait "$ROOT" 2>/dev/null
# shellcheck disable=SC2086
if _svsup_wait_pids_gone 5 $TREE; then
  no "_svsup_wait_pids_gone returns early while the descendant is still alive"
else
  ok "_svsup_wait_pids_gone keeps waiting while the descendant is still alive"
fi
kill -9 "$DESCENDANT" 2>/dev/null
# shellcheck disable=SC2086
if _svsup_wait_pids_gone 30 $TREE; then
  ok "_svsup_wait_pids_gone returns once the whole tree is gone"
else
  no "_svsup_wait_pids_gone returns once the whole tree is gone"
fi
cd "$WORK"

echo "a stop signal during restart backoff does not spawn one more child"
CASE10="$WORK/case-stopbackoff"; mkdir -p "$CASE10"; cd "$CASE10"
NAME10="${NAME_PREFIX}-stopbackoff"
# Target exits immediately, so the supervisor spends nearly all its time in
# the backoff sleep — the window where a stop signal used to leak a child.
"$SUP" --name "$NAME10" --health-url "http://127.0.0.1:18979/" --dir "$CASE10" \
  --interval 1 --failures 1 --max-restarts 9 -- bash -c 'exit 1' &
SUP_PID=$!
_wait_until "the supervisor to reach its backoff" 150 _line_count_at_least "$CASE10/.server-deaths.jsonl" 2
kill -TERM "$SUP_PID" 2>/dev/null
if _wait_until "the supervisor to exit" 100 bash -c "! kill -0 $SUP_PID 2>/dev/null"; then
  ok "the supervisor exits promptly when stopped mid-backoff"
fi
wait "$SUP_PID" 2>/dev/null
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
