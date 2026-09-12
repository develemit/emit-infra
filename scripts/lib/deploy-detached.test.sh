#!/usr/bin/env bash
# Tests for scripts/deploy-detached.sh (sprint 289). Two layers:
#  - unit cases: source the script (guarded against running main) and call
#    its functions directly against fabricated files — fast, no real git push
#  - integration cases: run the real executable against a scratch repo with
#    a bare remote and the real pre-push hook symlinked in, same harness
#    pattern as deploy-unattended-gate.test.sh
# Run: bash scripts/lib/deploy-detached.test.sh
set -uo pipefail

EMIT_INFRA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$EMIT_INFRA_ROOT/scripts/deploy-detached.sh"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ok   $1"; }
no() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else no "$1 (want '$3', got '$2')"; fi; }

echo "unit: sourcing does not launch anything"
( PROJECT_DIR=/tmp; source "$SCRIPT" )
check "sourcing the script exits 0 without running main" "$?" "0"

echo
echo "unit: project_name / record_field / status_base"
UNIT_WORK=$(mktemp -d)
trap 'rm -rf "$UNIT_WORK"' EXIT
mkdir -p "$UNIT_WORK/proj"
echo '{"name":"widget-api"}' > "$UNIT_WORK/proj/.emit-infra.json"
( source "$SCRIPT"; check "project_name reads .emit-infra.json" "$(project_name "$UNIT_WORK/proj")" "widget-api" )
( source "$SCRIPT"; check "project_name falls back on a missing config" "$(project_name "$UNIT_WORK/does-not-exist")" "project" )
( source "$SCRIPT"; check "status_base formats a 7-char short sha" "$(status_base widget-api 0123456789abcdef)" "/tmp/emit-deploy-widget-api-0123456" )

echo '{"status":"deployed","sha":"abc123"}' > "$UNIT_WORK/status.json"
( source "$SCRIPT"; check "record_field reads an existing key" "$(record_field "$UNIT_WORK/status.json" sha)" "abc123" )
( source "$SCRIPT"; check "record_field returns empty for a missing file" "$(record_field "$UNIT_WORK/no-such-file.json" sha)" "" )

echo
echo "unit: preflight refusals"
PF_WORK=$(mktemp -d)
PF_REMOTE="$PF_WORK/remote.git"
PF_REPO="$PF_WORK/repo"
git init -q --bare "$PF_REMOTE"
git init -q "$PF_REPO"
( cd "$PF_REPO" && git config user.email t@t.t && git config user.name t
  echo '{"name":"pf-test"}' > .emit-infra.json
  printf '.deploy-status.json\n.deploy-history.jsonl\n' > .gitignore
  echo base > f.txt && git add -A && git commit -qm base
  git remote add origin "$PF_REMOTE" && git push -q origin main ) >/dev/null 2>&1

pf_case() {
  # pf_case <label> <expected-message-substring> <setup-fn>
  local label="$1" want="$2" setup="$3" out rc
  "$setup"
  out=$(cd "$EMIT_INFRA_ROOT" && bash -c '
    source "'"$SCRIPT"'"
    PROJECT_DIR="'"$PF_REPO"'"
    preflight
  ' 2>&1)
  rc=$?
  if [[ $rc -ne 0 && "$out" == *"$want"* ]]; then ok "$label"; else no "$label (rc=$rc, out: $out)"; fi
}

setup_dirty() { echo dirty > "$PF_REPO/untracked.txt"; }
pf_case "refuses a dirty working tree" "dirty" setup_dirty
rm -f "$PF_REPO/untracked.txt"

setup_no_config() { true; }
( cd "$PF_REPO" && git checkout -qb side )
pf_case "refuses HEAD off main" "not main" setup_no_config
( cd "$PF_REPO" && git checkout -q main && git branch -qD side )

pf_case "refuses when there is nothing to push" "nothing to push" setup_no_config

setup_running() {
  printf '{"status":"deploying","sha":"x","writer":{"pid":%d,"host":"%s","heartbeatAt":"%s"}}\n' \
    "$$" "$(hostname -s)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$PF_REPO/.deploy-status.json"
  ( cd "$PF_REPO" && echo change1 >> f.txt && git add -A && git commit -qm change1 ) >/dev/null
}
pf_case "refuses an already-running deploy" "already running" setup_running
rm -f "$PF_REPO/.deploy-status.json"

setup_orphaned() {
  printf '{"status":"deploying","sha":"x","writer":{"pid":999999,"host":"%s","heartbeatAt":"2020-01-01T00:00:00Z"}}\n' \
    "$(hostname -s)" > "$PF_REPO/.deploy-status.json"
}
pf_case "refuses an orphaned deploy record, points at reconcile" "reconcile --write" setup_orphaned
rm -f "$PF_REPO/.deploy-status.json"

rm -rf "$PF_WORK"

echo
echo "unit: print_summary / poll_for_result"
PS_WORK=$(mktemp -d)
mkdir -p "$PS_WORK/proj"
PROJECT_DIR="$PS_WORK/proj"

printf '{"status":"deployed","sha":"deadbee"}\n' > "$PROJECT_DIR/.deploy-status.json"
printf '{"sha":"deadbee","servicesBuilt":["api","web"]}\n' > "$PROJECT_DIR/.deploy-history.jsonl"
( source "$SCRIPT"; PROJECT_DIR="$PROJECT_DIR"; print_summary deadbee "$PS_WORK/x" 0 >/dev/null; )
check "print_summary: deployed record -> exit 0" "$?" "0"

printf '{"status":"failed","sha":"deadbee"}\n' > "$PROJECT_DIR/.deploy-status.json"
( source "$SCRIPT"; PROJECT_DIR="$PROJECT_DIR"; print_summary deadbee "$PS_WORK/x" 0 >/dev/null; )
check "print_summary: failed record -> exit 3" "$?" "3"

rm -f "$PROJECT_DIR/.deploy-status.json" "$PROJECT_DIR/.deploy-history.jsonl"
( source "$SCRIPT"; PROJECT_DIR="$PROJECT_DIR"; print_summary deadbee "$PS_WORK/x" 0 >/dev/null; )
check "print_summary: no record, push exit 0 -> treated as a clean skip, exit 0" "$?" "0"
( source "$SCRIPT"; PROJECT_DIR="$PROJECT_DIR"; print_summary deadbee "$PS_WORK/x" 1 >/dev/null; )
check "print_summary: no record, push exit 1 -> exit 3" "$?" "3"

# sprint 292: a skip must be reported as a definite, reasoned outcome — read
# back from the hook's own skip message in the log, not "likely"/"unknown".
printf '⚠ deploy SKIPPED: every file changed since abc1234 matches an ignored pattern (sprint/**) — no deploy will run for def5678 (EMIT_FORCE_DEPLOY=1 to override)\n' \
  > "$PS_WORK/x.log"
SKIP_OUT=$( ( source "$SCRIPT"; PROJECT_DIR="$PROJECT_DIR"; print_summary deadbee "$PS_WORK/x" 0; ) )
case "$SKIP_OUT" in
  *"likely"*|*": unknown"*) no "print_summary: recognized skip reads the hook's own reason, no 'likely'/'unknown' (got: $SKIP_OUT)" ;;
  *"deploy SKIPPED"*) ok "print_summary: recognized skip reads the hook's own reason, no 'likely'/'unknown'" ;;
  *) no "print_summary: recognized skip reads the hook's own reason, no 'likely'/'unknown' (got: $SKIP_OUT)" ;;
esac
rm -f "$PS_WORK/x.log"

POLL_BASE="$PS_WORK/poll"
echo 0 > "${POLL_BASE}.rc"
( source "$SCRIPT"; PROJECT_DIR="$PROJECT_DIR"; poll_for_result deadbee "$POLL_BASE" 30 >/dev/null; )
check "poll_for_result: rc file already present -> resolves immediately" "$?" "0"

# sprint 329: no record at all (or a record for another sha) reads as
# "not started", never as "running" — that distinction is the whole point.
rm -f "${POLL_BASE}.rc" "$PROJECT_DIR/.deploy-status.json"
OUT=$( ( source "$SCRIPT"; PROJECT_DIR="$PROJECT_DIR"; poll_for_result deadbee "$POLL_BASE" 1; ) )
RC=$?
check "poll_for_result: times out without killing anything, distinct exit code" "$RC" "2"
case "$OUT" in
  *"still running"*) no "poll_for_result: no record yet -> not reported as running (got: $OUT)" ;;
  *"no record"*) ok "poll_for_result: no record yet is distinguishable from running" ;;
  *) no "poll_for_result: no record yet is distinguishable from running (got: $OUT)" ;;
esac

printf '{"status":"deploying","sha":"deadbee"}\n' > "$PROJECT_DIR/.deploy-status.json"
OUT=$( ( source "$SCRIPT"; PROJECT_DIR="$PROJECT_DIR"; poll_for_result deadbee "$POLL_BASE" 1; ) )
RC=$?
check "poll_for_result: matching in-flight record times out, distinct exit code" "$RC" "2"
case "$OUT" in *"still running"*) ok "poll_for_result: timeout message says still running for a matching record" ;;
  *) no "poll_for_result: timeout message says still running for a matching record (got: $OUT)" ;; esac

rm -rf "$PS_WORK"

echo
echo "unit: watch_main"
# sprint 329: watch_main must resolve the sha it watches from git HEAD, same
# as the launch path — never from whatever .deploy-status.json holds, since
# that file can still carry a *previous* deploy's record. Needs a real repo
# so target_sha's `git rev-parse HEAD` has something to resolve.
WM_WORK=$(mktemp -d)
mkdir -p "$WM_WORK/proj"
( cd "$WM_WORK/proj" && git init -q && git config user.email t@t.t && git config user.name t
  echo '{"name":"watch-proj"}' > .emit-infra.json
  git add -A && git commit -qm base ) >/dev/null 2>&1
WM_HEAD=$(cd "$WM_WORK/proj" && git rev-parse HEAD)

( source "$SCRIPT"; PROJECT_DIR="$WM_WORK/proj"; TIMEOUT=5; watch_main >/dev/null 2>&1; )
check "watch_main: no status file -> refuses" "$?" "1"

# The stale-record regression (sprint 329): a terminal record — AND its
# matching .rc sentinel — for a *different* sha than HEAD must never be
# reported as this deploy's outcome. Fails against pre-fix code, which reads
# the sha straight out of the status file and would immediately report
# "deploy finished: deployed" here.
echo '{"sha":"deadbeefstale","status":"deployed"}' > "$WM_WORK/proj/.deploy-status.json"
STALE_BASE=$( ( source "$SCRIPT"; status_base watch-proj deadbeefstale ) )
echo 0 > "${STALE_BASE}.rc"
WM_OUT=$( ( source "$SCRIPT"; PROJECT_DIR="$WM_WORK/proj"; TIMEOUT=1; watch_main 2>&1; ) )
WM_RC=$?
check "watch_main: a stale sha's terminal record does not resolve this deploy" "$WM_RC" "2"
case "$WM_OUT" in
  *"deploy finished: deployed"*) no "watch_main: stale record's outcome is not reported (got: $WM_OUT)" ;;
  *"no record"*) ok "watch_main: stale record is reported as no-record-yet, not this deploy's outcome" ;;
  *) no "watch_main: stale record is reported as no-record-yet, not this deploy's outcome (got: $WM_OUT)" ;;
esac
rm -f "${STALE_BASE}.rc" "${STALE_BASE}.log"

echo "{\"sha\":\"$WM_HEAD\",\"status\":\"deployed\"}" > "$WM_WORK/proj/.deploy-status.json"
BASE=$( ( source "$SCRIPT"; status_base watch-proj "$WM_HEAD" ) )
echo 0 > "${BASE}.rc"
( source "$SCRIPT"; PROJECT_DIR="$WM_WORK/proj"; TIMEOUT=5; watch_main >/dev/null 2>&1; )
check "watch_main: finds HEAD sha's rc file and resolves" "$?" "0"
rm -f "${BASE}.rc" "${BASE}.log"
rm -rf "$WM_WORK"

echo
echo "integration: real pre-push hook, no GHCR configured (deploy phase skips)"
IT_WORK=$(mktemp -d)
IT_REMOTE="$IT_WORK/remote.git"
IT_REPO="$IT_WORK/repo"
git init -q --bare "$IT_REMOTE"
git init -q "$IT_REPO"
( cd "$IT_REPO" && git config user.email t@t.t && git config user.name t
  cat > .emit-infra.json <<'JSON'
{"name":"detached-test","ci":{"ghcrOrg":"","prePush":[]}}
JSON
  printf '.deploy-status.json\n.deploy-history.jsonl\n.ci-status.json\n.ci-history.jsonl\n.ci-logs/\n.deploy-logs/\n' > .gitignore
  mkdir -p .githooks
  ln -s "$EMIT_INFRA_ROOT/scripts/hooks/pre-push" .githooks/pre-push
  git add -A && git commit -qm base
  git config core.hooksPath .githooks
  git remote add origin "$IT_REMOTE"
  git push -q origin main ) >/dev/null 2>&1

( cd "$IT_REPO" && echo change >> f.txt 2>/dev/null || echo change > f.txt; git add -A && git commit -qm change ) >/dev/null

OUT=$(bash "$SCRIPT" --dir "$IT_REPO" --timeout 30 2>&1)
RC=$?
check "launch+wait: exits 0 when the push completes cleanly" "$RC" "0"
case "$OUT" in *"log:"*) ok "launch+wait: prints the log path" ;; *) no "launch+wait: prints the log path (got: $OUT)" ;; esac
REMOTE_HEAD=$(git --git-dir="$IT_REMOTE" rev-parse main)
LOCAL_HEAD=$(cd "$IT_REPO" && git rev-parse HEAD)
check "launch+wait: commit actually lands on the bare remote" "$REMOTE_HEAD" "$LOCAL_HEAD"

# A `git` shim that sleeps before an actual `push` — gives both cases below a
# real in-flight window without needing a slow CI target or real GHCR/docker.
REAL_GIT=$(command -v git)
SHIM_DIR="$IT_WORK/bin"
mkdir -p "$SHIM_DIR"
cat > "$SHIM_DIR/git" <<EOF
#!/usr/bin/env bash
if [[ "\$1" == "push" ]]; then sleep "\${EMIT_TEST_SLOW_PUSH:-0}"; fi
exec "$REAL_GIT" "\$@"
EOF
chmod +x "$SHIM_DIR/git"

echo
echo "integration: --no-wait launches and returns immediately"
( cd "$IT_REPO" && echo change-nowait >> f.txt && git add -A && git commit -qm change-nowait ) >/dev/null
NOWAIT_SHA=$(cd "$IT_REPO" && git rev-parse HEAD)
# `date +%s` truncates to whole seconds, so a 4s fake push left this comparison
# with zero real margin: preflight's own node startup (classify-run-state.mjs)
# pushes wall time past the second boundary under load and fails a case that
# is otherwise a correctness non-issue. Two independent fixes: measure with a
# sub-second clock (python3, already a hard dependency of this suite for JSON
# parsing) instead of second-granularity `date`, and widen the fake push to 8s
# so the pass/fail line sits seconds away from realistic launcher overhead
# rather than immediately adjacent to it.
NOWAIT_START=$(python3 -c 'import time; print(time.time())')
NOWAIT_OUT=$(PATH="$SHIM_DIR:$PATH" EMIT_TEST_SLOW_PUSH=8 bash "$SCRIPT" --dir "$IT_REPO" --no-wait --timeout 30 2>&1)
NOWAIT_RC=$?
NOWAIT_ELAPSED_MS=$(python3 -c "import time; print(round((time.time() - $NOWAIT_START) * 1000))")
check "--no-wait: exits 0 immediately" "$NOWAIT_RC" "0"
case "$NOWAIT_OUT" in
  *"log:"*) ok "--no-wait: prints the log path" ;;
  *) no "--no-wait: prints the log path (got: $NOWAIT_OUT)" ;;
esac
if [[ $NOWAIT_ELAPSED_MS -lt 4000 ]]; then
  ok "--no-wait: returns before the 8s push finishes (${NOWAIT_ELAPSED_MS}ms)"
else
  no "--no-wait: returns before the 8s push finishes (took ${NOWAIT_ELAPSED_MS}ms)"
fi

# Let the detached push actually land before the next case reuses IT_REPO.
NOWAIT_DEADLINE=$(($(date +%s) + 20))
while [[ $(date +%s) -lt $NOWAIT_DEADLINE ]]; do
  [[ "$(git --git-dir="$IT_REMOTE" rev-parse main 2>/dev/null)" == "$NOWAIT_SHA" ]] && break
  sleep 1
done

echo
echo "integration: the critical case — kill the launcher, the push survives"
( cd "$IT_REPO" && echo change2 >> f.txt && git add -A && git commit -qm change2 ) >/dev/null
LOCAL_HEAD=$(cd "$IT_REPO" && git rev-parse HEAD)

PATH="$SHIM_DIR:$PATH" EMIT_TEST_SLOW_PUSH=5 \
  bash "$SCRIPT" --dir "$IT_REPO" --timeout 30 > "$IT_WORK/launcher.out" 2>&1 &
LAUNCHER_PID=$!

# Sync on the "launched" marker rather than a fixed sleep — preflight's node
# invocation (classify-run-state.mjs) has cold-start jitter that can outlast
# a short sleep under load, which would kill the launcher before it ever
# backgrounds the push and make this test pass for the wrong reason (nothing
# to survive). A generous wait here still exercises the real race: the push
# itself sleeps 5s inside the nohup'd child, well past this point.
READY_DEADLINE=$(($(date +%s) + 15))
while [[ $(date +%s) -lt $READY_DEADLINE ]]; do
  grep -q "launched detached deploy" "$IT_WORK/launcher.out" 2>/dev/null && break
  sleep 0.2
done
kill -9 "$LAUNCHER_PID" 2>/dev/null
wait "$LAUNCHER_PID" 2>/dev/null

DEADLINE=$(($(date +%s) + 25))
REMOTE_HEAD=""
while [[ $(date +%s) -lt $DEADLINE ]]; do
  REMOTE_HEAD=$(git --git-dir="$IT_REMOTE" rev-parse main 2>/dev/null || echo "")
  [[ "$REMOTE_HEAD" == "$LOCAL_HEAD" ]] && break
  sleep 1
done

check "survives launcher SIGKILL: commit still lands on the bare remote" "$REMOTE_HEAD" "$LOCAL_HEAD"
check "survives launcher SIGKILL: a terminal CI record is written" \
  "$(python3 -c "import json;print(json.load(open('$IT_REPO/.ci-status.json'))['status'])" 2>/dev/null || echo "")" \
  "success"

rm -rf "$IT_WORK"

echo
echo "$PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
