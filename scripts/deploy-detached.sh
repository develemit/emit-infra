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
    env EMIT_ALLOW_UNATTENDED_DEPLOY=1 git push origin main
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
  while [[ ! -f "${base}.rc" ]]; do
    elapsed=$(( $(date +%s) - start ))
    if [[ $elapsed -ge $timeout ]]; then
      echo "⏳ still running after ${timeout}s — not killing it."
      echo "  log: ${base}.log"
      echo "  resume watching with: $SELF --dir '$PROJECT_DIR' --watch"
      return 2
    fi
    sleep 10
  done
  rc=$(cat "${base}.rc" 2>/dev/null || echo "")

  print_summary "$sha" "$base" "$rc"
}

# The deploy-status record alone can't tell "skipped, all good" apart from
# "CI failed before deploy ever started" — both leave no record for this sha
# — so the push's own exit code (rc) is the tie-breaker for that case.
print_summary() {
  local sha="$1" base="$2" rc="$3"
  local status_file="$PROJECT_DIR/.deploy-status.json"
  local history_file="$PROJECT_DIR/.deploy-history.jsonl"
  local record_sha="" record_status="" services="unknown" ok=1

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
    print('unknown')
" 2>/dev/null || echo "unknown")
  fi

  echo
  if [[ -n "$record_status" ]]; then
    echo "→ deploy finished: $record_status"
    [[ "$record_status" == "deployed" ]] || ok=0
  elif [[ "$rc" == "0" ]]; then
    echo "→ push completed (exit 0); no deploy record for ${sha:0:7} — deploy was likely skipped (ignored paths / nothing to build)"
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
  sha=$(record_field "$status_file" sha)
  [[ -n "$sha" ]] || die "$status_file has no 'sha' field — nothing to watch"
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
  sha=$(cd "$PROJECT_DIR" && git rev-parse HEAD)
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
