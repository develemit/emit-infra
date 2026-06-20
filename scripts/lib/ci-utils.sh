# ci-utils.sh — shared CI/deploy status helpers for emit projects
#
# Source this file at the top of ci.sh and deploy.sh:
#   source "$HOME/projects/emit-infra/scripts/lib/ci-utils.sh"
#
# CI usage:
#   ci_init <total_steps>     # write running status, capture git context
#   ci_step "label"           # write progress update before each step
#   ci_done success|failure   # write final status + append to history
#
# Deploy usage:
#   deploy_init <total_steps>
#   deploy_set_services web api worker  # record which services are being built
#   deploy_step "label"
#   deploy_done deployed|failed         # write final status + append to history

# Guard against double-sourcing without resetting in-flight state
[[ -n "${_EMIT_CI_UTILS_LOADED:-}" ]] && return 0
_EMIT_CI_UTILS_LOADED=1

_EMIT_SHA=""
_EMIT_BRANCH=""
_EMIT_STARTED=""
_EMIT_STARTED_EPOCH=0
_EMIT_CI_STEP=0
_EMIT_CI_TOTAL=0
_EMIT_DEPLOY_STEP=0
_EMIT_DEPLOY_TOTAL=0
_EMIT_SERVICES_BUILT=""
_EMIT_LOG_FILE=""
_EMIT_DEPLOY_LOG_FILE=""

_emit_rotate_logs() {
  local dir="$1" max="${2:-100}"
  local count
  count=$(ls -t "$dir"/*.log 2>/dev/null | wc -l)
  if [[ $count -gt $max ]]; then
    ls -t "$dir"/*.log 2>/dev/null | tail -n +"$((max + 1))" | xargs rm -f
  fi
}

_emit_truncate_history() {
  local f="$1" max=1000 keep=500
  if [[ -f "$f" ]] && [[ $(wc -l < "$f") -gt $max ]]; then
    tail -n "$keep" "$f" > "${f}.tmp" && mv "${f}.tmp" "$f"
  fi
}

_emit_services_json() {
  if [[ -z "$_EMIT_SERVICES_BUILT" ]]; then
    echo "[]"
    return
  fi
  printf '["%s"]\n' "$(echo "$_EMIT_SERVICES_BUILT" | sed 's/ /","/g')"
}

deploy_set_services() { _EMIT_SERVICES_BUILT="$*"; }

ci_init() {
  _EMIT_CI_TOTAL=$1
  _EMIT_CI_STEP=0
  _EMIT_SHA=$(git rev-parse HEAD)
  _EMIT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
  _EMIT_STARTED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  _EMIT_STARTED_EPOCH=$(date +%s)
  if mkdir -p ".ci-logs" 2>/dev/null; then
    _EMIT_LOG_FILE=".ci-logs/${_EMIT_SHA}.log"
    exec > >(tee -a "$_EMIT_LOG_FILE") 2>&1
  fi
  printf '{"status":"running","sha":"%s","branch":"%s","startedAt":"%s","progress":{"step":0,"total":%d,"pct":0,"label":"starting"}}\n' \
    "$_EMIT_SHA" "$_EMIT_BRANCH" "$_EMIT_STARTED" "$_EMIT_CI_TOTAL" > .ci-status.json
}

ci_step() {
  _EMIT_CI_STEP=$((_EMIT_CI_STEP + 1))
  local pct=$((_EMIT_CI_STEP * 100 / _EMIT_CI_TOTAL))
  printf '{"status":"running","sha":"%s","branch":"%s","startedAt":"%s","progress":{"step":%d,"total":%d,"pct":%d,"label":"%s"}}\n' \
    "$_EMIT_SHA" "$_EMIT_BRANCH" "$_EMIT_STARTED" \
    "$_EMIT_CI_STEP" "$_EMIT_CI_TOTAL" "$pct" "$1" > .ci-status.json
}

ci_done() {
  local completed_at
  completed_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local duration=$(( $(date +%s) - _EMIT_STARTED_EPOCH ))

  printf '{"status":"%s","sha":"%s","branch":"%s","completedAt":"%s"}\n' \
    "$1" "$_EMIT_SHA" "$_EMIT_BRANCH" "$completed_at" > .ci-status.json

  printf '{"status":"%s","sha":"%s","branch":"%s","startedAt":"%s","completedAt":"%s","durationSec":%d}\n' \
    "$1" "$_EMIT_SHA" "$_EMIT_BRANCH" "$_EMIT_STARTED" "$completed_at" "$duration" >> .ci-history.jsonl

  _emit_truncate_history .ci-history.jsonl
  [[ -d ".ci-logs" ]] && _emit_rotate_logs .ci-logs
}

deploy_init() {
  _EMIT_DEPLOY_TOTAL=$1
  _EMIT_DEPLOY_STEP=0
  _EMIT_SHA=$(git rev-parse HEAD)
  _EMIT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
  _EMIT_STARTED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  _EMIT_STARTED_EPOCH=$(date +%s)
  if mkdir -p ".deploy-logs" 2>/dev/null; then
    _EMIT_DEPLOY_LOG_FILE=".deploy-logs/${_EMIT_SHA}.log"
    exec > >(tee -a "$_EMIT_DEPLOY_LOG_FILE") 2>&1
  fi
  printf '{"status":"deploying","sha":"%s","branch":"%s","startedAt":"%s","progress":{"step":0,"total":%d,"pct":0,"label":"starting"}}\n' \
    "$_EMIT_SHA" "$_EMIT_BRANCH" "$_EMIT_STARTED" "$_EMIT_DEPLOY_TOTAL" > .deploy-status.json
}

deploy_step() {
  _EMIT_DEPLOY_STEP=$((_EMIT_DEPLOY_STEP + 1))
  local pct=$((_EMIT_DEPLOY_STEP * 100 / _EMIT_DEPLOY_TOTAL))
  printf '{"status":"deploying","sha":"%s","branch":"%s","startedAt":"%s","progress":{"step":%d,"total":%d,"pct":%d,"label":"%s"}}\n' \
    "$_EMIT_SHA" "$_EMIT_BRANCH" "$_EMIT_STARTED" \
    "$_EMIT_DEPLOY_STEP" "$_EMIT_DEPLOY_TOTAL" "$pct" "$1" > .deploy-status.json
}

deploy_done() {
  local completed_at
  completed_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local duration=$(( $(date +%s) - _EMIT_STARTED_EPOCH ))

  printf '{"status":"%s","sha":"%s","branch":"%s","completedAt":"%s"}\n' \
    "$1" "$_EMIT_SHA" "$_EMIT_BRANCH" "$completed_at" > .deploy-status.json

  printf '{"status":"%s","sha":"%s","branch":"%s","startedAt":"%s","completedAt":"%s","durationSec":%d,"servicesBuilt":%s}\n' \
    "$1" "$_EMIT_SHA" "$_EMIT_BRANCH" "$_EMIT_STARTED" "$completed_at" "$duration" "$(_emit_services_json)" >> .deploy-history.jsonl

  _emit_truncate_history .deploy-history.jsonl
  [[ -d ".deploy-logs" ]] && _emit_rotate_logs .deploy-logs
}
