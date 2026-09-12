#!/usr/bin/env bash
# deploy-detached.sh — launch `git push origin main` detached from the
# caller's own lifetime, then poll .deploy-status.json until it reaches a
# terminal state. See sprint 289.
#
# Why: sprint 288's pre-push gate refuses to deploy from a teardown-prone
# shell (CLAUDECODE / CLAUDE_CODE_ENTRYPOINT / CI set) because a deploy tied
# to that shell's lifetime dies mid-build when the shell is torn down
# (2026-08-19 emit-social incident). Detaching the whole push — not just the
# deploy phase — keeps prod and origin/main moving together (see the sprint
# file's Context section for why only detaching the deploy phase is unsafe).
#
# Usage:
#   scripts/deploy-detached.sh [--dir <path>] [--timeout <sec>] [--no-wait]
#   scripts/deploy-detached.sh [--dir <path>] [--timeout <sec>] --watch
#
#   --dir <path>    Project directory to deploy (default: cwd)
#   --timeout <sec> Poll ceiling in seconds (default: 3600)
#   --no-wait       Launch and return immediately; prints the log path
#   --watch         Attach to an already-running detached deploy using only
#                    the log path and status file; never relaunches
set -uo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
EMIT_INFRA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$EMIT_INFRA_ROOT/scripts/lib/deploy-plan.sh"

# ':=' defaults, not plain assignment — this file is sourced by
# deploy-detached.test.sh to unit-test individual functions, and a plain
# `PROJECT_DIR="$(pwd)"` here would silently clobber whatever the caller set
# before sourcing. main() applies the cwd default itself once parse_args has
# had a chance to run.
: "${PROJECT_DIR:=}"
: "${TIMEOUT:=3600}"
: "${NO_WAIT:=0}"
: "${WATCH:=0}"

die() { echo "✗ deploy-detached: $*" >&2; exit 1; }

usage() { sed -n '2,20p' "$SELF"; }

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dir) PROJECT_DIR="$2"; shift 2 ;;
      --timeout) TIMEOUT="$2"; shift 2 ;;
      --no-wait) NO_WAIT=1; shift ;;
      --watch) WATCH=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown argument '$1' (see --help)" ;;
    esac
  done
}

classify_run_state() {
  node "$EMIT_INFRA_ROOT/scripts/lib/classify-run-state.mjs" "$1/.deploy-status.json"
}

project_name() {
  (cd "$1" 2>/dev/null && python3 -c "import json;print(json.load(open('.emit-infra.json')).get('name','project'))" 2>/dev/null) || echo "project"
}

record_field() {
  # record_field <status-file> <key> -> '' if missing/unreadable
  python3 -c "import json;print(json.load(open('$1')).get('$2',''))" 2>/dev/null || echo ""
}

# The sha a detached deploy for PROJECT_DIR is always about — sprint 329.
# Both launch (main) and --watch (watch_main) must derive it the same way,
# from git HEAD, never from whatever .deploy-status.json happens to hold: that
# file can (and did, 2026-09-11) still be carrying a *previous* deploy's
# terminal record when --watch starts polling.
target_sha() {
  (cd "$PROJECT_DIR" && git rev-parse HEAD)
}

# Tells --watch's caller whether a record for the target sha exists yet,
# distinct from "running" (record present, not yet terminal) and from
# "finished" (the .rc sentinel is what poll_for_result already checks for
# that). A record for a *different* sha — stale, from a prior deploy — must
# read the same as no record at all.
record_state_for_sha() {
  local sha="$1" status_file="$PROJECT_DIR/.deploy-status.json" record_sha
  if [[ -f "$status_file" ]]; then
    record_sha=$(record_field "$status_file" sha)
    [[ "$record_sha" == "$sha" ]] && { echo "running"; return; }
  fi
  echo "not-started"
}

# ── preflight ──────────────────────────────────────────────────────────────
preflight() {
  [[ -d "$PROJECT_DIR/.git" ]] || die "not a git repository: $PROJECT_DIR"
  [[ -f "$PROJECT_DIR/.emit-infra.json" ]] || die "no .emit-infra.json in $PROJECT_DIR"

  local dirty
  dirty=$(cd "$PROJECT_DIR" && git status --porcelain)
  [[ -z "$dirty" ]] || die "working tree is dirty; commit or stash before a detached deploy"

  local branch
  branch=$(cd "$PROJECT_DIR" && git rev-parse --abbrev-ref HEAD)
  [[ "$branch" == "main" ]] || die "HEAD is on '$branch', not main; a detached deploy only runs from main"

  (cd "$PROJECT_DIR" && git fetch origin main --quiet 2>/dev/null) ||
    echo "⚠ deploy-detached: couldn't fetch origin/main; nothing-to-push check may be stale" >&2

  local ahead
  ahead=$(cd "$PROJECT_DIR" && git rev-list origin/main..HEAD --count 2>/dev/null || echo "")
  [[ "$ahead" != "0" ]] || die "nothing to push — HEAD already matches origin/main"

  case "$(classify_run_state "$PROJECT_DIR")" in
    running) die "a deploy is already running for this project; use --watch to attach instead of relaunching" ;;
    orphaned) die "the last deploy record is orphaned; run 'emit-infra reconcile --write' before launching a new one" ;;
  esac
}

# ── launch ─────────────────────────────────────────────────────────────────
# The whole push+deploy runs inside a nohup'd bash -c so it survives this
# script (and its caller's shell) being torn down; the exit code lands in
# .rc once it's done, which is what polling actually waits on — the deploy
# status file alone can't distinguish "still in CI" from "push was rejected"
# from "deploy was skipped" (ignored-paths / dry-run), but a finished push
# process always writes its exit code.
launch() {
  local sha="$1" base="$2"
  rm -f "${base}.rc"
  : > "${base}.log"
  nohup bash -c '
    cd "$1" || exit 1
    env EMIT_DEPLOY_DETACHED=1 git push origin main
    echo $? > "$2"
  ' -- "$PROJECT_DIR" "${base}.rc" > "${base}.log" 2>&1 &
  disown $! 2>/dev/null || true

  echo "→ launched detached deploy for $(project_name "$PROJECT_DIR") @ ${sha:0:7}"
  echo "  log: ${base}.log"
  echo "  resume with: $SELF --dir '$PROJECT_DIR' --watch"
}

# ── poll ───────────────────────────────────────────────────────────────────
poll_for_result() {
  local sha="$1" base="$2" timeout="$3" start elapsed rc
  start=$(date +%s)

  echo "→ polling for completion (timeout ${timeout}s); log: ${base}.log"
  case "$(record_state_for_sha "$sha")" in
    running) echo "  status: running" ;;
    not-started) echo "  status: no record yet for ${sha:0:7} — hasn't started, or record not written" ;;
  esac
  while [[ ! -f "${base}.rc" ]]; do
    elapsed=$(( $(date +%s) - start ))
    if [[ $elapsed -ge $timeout ]]; then
      case "$(record_state_for_sha "$sha")" in
        running) echo "⏳ still running after ${timeout}s — not killing it." ;;
        not-started) echo "⏳ still no record for ${sha:0:7} after ${timeout}s — not killing it." ;;
      esac
      echo "  log: ${base}.log"
      echo "  resume watching with: $SELF --dir '$PROJECT_DIR' --watch"
      return 2
    fi
    sleep 10
  done
  rc=$(cat "${base}.rc" 2>/dev/null || echo "")

  print_summary "$sha" "$base" "$rc"
}

# The deploy-status record alone can't tell "skipped, all good" apart from a
# push that failed before ever reaching the deploy gates — both leave no
# record for this sha. rc==0 (git push succeeded) rules the latter out, since
# a failing pre-push hook fails the push itself; every exit-0 gate the hook
# can take (ignored paths, dry run, ci.ghcrOrg unset) prints its own reason on
# its way out, so read that back from the log instead of guessing (sprint
# 292: "likely skipped" is exactly the phrasing that let a real stuck
# backlog read as routine).
_skip_reason_from_log() {
  grep -m1 -E '^(⚠ deploy SKIPPED|→ git push --dry-run detected|→ deploy declined|pre-push: ci\.ghcrOrg not set)' "$1" 2>/dev/null || true
}

print_summary() {
  local sha="$1" base="$2" rc="$3"
  local status_file="$PROJECT_DIR/.deploy-status.json"
  local history_file="$PROJECT_DIR/.deploy-history.jsonl"
  local record_sha="" record_status="" services="(none — no deploy ran)" ok=1

  [[ -f "$status_file" ]] && record_sha=$(record_field "$status_file" sha)
  [[ "$record_sha" == "$sha" ]] && record_status=$(record_field "$status_file" status)

  if [[ -f "$history_file" ]]; then
    services=$(python3 -c "
import json
sha, line = '$sha', ''
with open('$history_file') as f:
    for l in f:
        l = l.strip()
        if not l: continue
        try: e = json.loads(l)
        except Exception: continue
        if e.get('sha') == sha: line = l
if line:
    built = json.loads(line).get('servicesBuilt', [])
    print(', '.join(built) if built else '(none — re-tag only)')
else:
    print('(none — no deploy ran)')
" 2>/dev/null || echo "(none — no deploy ran)")
  fi

  echo
  if [[ -n "$record_status" ]]; then
    echo "→ deploy finished: $record_status"
    [[ "$record_status" == "deployed" ]] || ok=0
  elif [[ "$rc" == "0" ]]; then
    local reason
    reason=$(_skip_reason_from_log "${base}.log")
    if [[ -n "$reason" ]]; then
      echo "→ deploy SKIPPED (push succeeded, this was intentional): $reason"
    else
      echo "→ push completed (exit 0) but no deploy record for ${sha:0:7} and no recognized skip message in the log — read ${base}.log directly"
    fi
  else
    echo "→ push failed (exit $rc); no deploy reached this sha — check CI"
    ok=0
  fi
  echo "  services: $services"
  echo "  log: ${base}.log"

  if [[ $ok -eq 0 ]]; then
    echo
    echo "── last 20 lines of ${base}.log ──"
    tail -n 20 "${base}.log" 2>/dev/null
    return 3
  fi
  return 0
}

status_base() {
  # /tmp/emit-deploy-<project>-<shortsha>, sans extension
  echo "/tmp/emit-deploy-$1-${2:0:7}"
}

watch_main() {
  local status_file="$PROJECT_DIR/.deploy-status.json" sha
  [[ -f "$status_file" ]] || die "no $status_file — nothing to watch"
  sha=$(target_sha) || die "cannot resolve HEAD in $PROJECT_DIR — nothing to watch"
  poll_for_result "$sha" "$(status_base "$(project_name "$PROJECT_DIR")" "$sha")" "$TIMEOUT"
}

main() {
  parse_args "$@"
  [[ -n "$PROJECT_DIR" ]] || PROJECT_DIR="$(pwd)"
  PROJECT_DIR="$(cd "$PROJECT_DIR" 2>/dev/null && pwd)" || die "no such directory: $PROJECT_DIR"

  if [[ $WATCH -eq 1 ]]; then
    watch_main
    exit $?
  fi

  preflight

  local sha base
  sha=$(target_sha)
  base="$(status_base "$(project_name "$PROJECT_DIR")" "$sha")"
  launch "$sha" "$base"

  [[ $NO_WAIT -eq 1 ]] && exit 0

  poll_for_result "$sha" "$base" "$TIMEOUT"
  exit $?
}

# Sourceable for unit tests (deploy-detached.test.sh) without running main —
# only exec main when invoked directly, same guard idiom bash libraries use.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
