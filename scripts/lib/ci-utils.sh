# ci-utils.sh — shared CI/deploy status helpers for emit projects
#
# Source this file at the top of ci.sh and deploy.sh:
#   source "$HOME/projects/emit-infra/scripts/lib/ci-utils.sh"
#
# CI usage:
#   ci_init <total_steps>     # write running status, capture git context
#   ci_step "label"           # write progress update before each step
#   ci_done success|failure   # write final status (no progress field)
#
# Deploy usage:
#   deploy_init <total_steps>
#   deploy_step "label"
#   deploy_done deployed|failed

# Guard against double-sourcing without resetting in-flight state
[[ -n "${_EMIT_CI_UTILS_LOADED:-}" ]] && return 0
_EMIT_CI_UTILS_LOADED=1

_EMIT_SHA=""
_EMIT_BRANCH=""
_EMIT_STARTED=""
_EMIT_CI_STEP=0
_EMIT_CI_TOTAL=0
_EMIT_DEPLOY_STEP=0
_EMIT_DEPLOY_TOTAL=0

ci_init() {
  _EMIT_CI_TOTAL=$1
  _EMIT_CI_STEP=0
  _EMIT_SHA=$(git rev-parse HEAD)
  _EMIT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
  _EMIT_STARTED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
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
  printf '{"status":"%s","sha":"%s","branch":"%s","completedAt":"%s"}\n' \
    "$1" "$_EMIT_SHA" "$_EMIT_BRANCH" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" > .ci-status.json
}

deploy_init() {
  _EMIT_DEPLOY_TOTAL=$1
  _EMIT_DEPLOY_STEP=0
  _EMIT_SHA=$(git rev-parse HEAD)
  _EMIT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
  _EMIT_STARTED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
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
  printf '{"status":"%s","sha":"%s","branch":"%s","completedAt":"%s"}\n' \
    "$1" "$_EMIT_SHA" "$_EMIT_BRANCH" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" > .deploy-status.json
}
