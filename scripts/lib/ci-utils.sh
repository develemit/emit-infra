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
#   deploy_init <total_steps> [launch_mode] [launch_marker]
#   deploy_set_services web api worker  # record which services are being built
#   deploy_step "label"
#   deploy_image_progress <name> <index> <total> <action>  # which image is building/retagging (sprint 339)
#   deploy_phase <name>                 # start timing a phase (closes the previous one)
#   deploy_record_phase <name> <sec>    # record a phase timed elsewhere (e.g. ci)
#   deploy_done deployed|failed|interrupted  # write final status + append to history
#
# Phase durations land in .deploy-history.jsonl as {"phases":{"build":312,...}}
# so slow deploys can be diagnosed from data instead of scrollback.
#
# In-flight status files (running/deploying) also carry a "writer" block —
# {"pid":12345,"host":"studio","heartbeatAt":"..."} — so a reader can tell a
# live run from an orphaned one (sprint 283). Terminal records omit it.
#
# Deploy records (not CI) also carry a "launch" block —
# {"mode":"detached|interactive|unattended-override","marker":"CLAUDECODE"} —
# stamped from scripts/hooks/pre-push's gate decision (sprint 290's
# deploy_launch_mode in deploy-launch.sh). Unlike "writer", "launch" survives
# onto terminal records: it's a fact about how the deploy started, not a
# liveness signal, so it stays useful after the deploy finishes.
#
# packages/core/src/deploy-records.ts mirrors both shapes deliberately; keep
# field names/types identical if either side changes.
#
# This file keeps module state + the ci/deploy writers (ci_init/ci_step/
# ci_done/deploy_init/deploy_step/deploy_done) — they touch nearly every
# piece of state below, so splitting them out would buy little and risks the
# most. Everything else is split into narrower-footprint files this sources
# internally; every consumer that used to source this file alone still gets
# all of them transitively. See ci-log-capture.sh, ci-atomic-write.sh,
# ci-phase-tracking.sh, ci-heartbeat.sh, and ci-signals.sh for the rest of
# the functions historically documented here (split in sprint 301).

# Guard against double-sourcing without resetting in-flight state
[[ -n "${_EMIT_CI_UTILS_LOADED:-}" ]] && return 0
_EMIT_CI_UTILS_LOADED=1

_EMIT_CI_UTILS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_EMIT_CI_UTILS_DIR/ci-log-capture.sh"
source "$_EMIT_CI_UTILS_DIR/ci-atomic-write.sh"
source "$_EMIT_CI_UTILS_DIR/ci-phase-tracking.sh"
source "$_EMIT_CI_UTILS_DIR/ci-heartbeat.sh"
source "$_EMIT_CI_UTILS_DIR/ci-signals.sh"

_EMIT_SHA=""
_EMIT_BRANCH=""
_EMIT_MSG=""
_EMIT_STARTED=""
_EMIT_STARTED_EPOCH=0
_EMIT_CI_STEP=0
_EMIT_CI_TOTAL=0
_EMIT_DEPLOY_STEP=0
_EMIT_DEPLOY_TOTAL=0
_EMIT_DEPLOY_LABEL=""
_EMIT_LAUNCH_MODE="interactive"
_EMIT_LAUNCH_MARKER=""
_EMIT_SERVICES_BUILT=""
_EMIT_LOG_FILE=""
_EMIT_DEPLOY_LOG_FILE=""
_EMIT_TEE_PID=""
_EMIT_PHASES=""
_EMIT_PHASE_NAME=""
_EMIT_PHASE_EPOCH=0
_EMIT_CI_DURATION=0
_EMIT_CI_FINALIZED=0
_EMIT_DEPLOY_FINALIZED=0

# ── writer liveness metadata (sprint 283) ───────────────────────────────────
# pid/host are constant for this process's whole lifetime, so compute them
# once at source time rather than per write.
_EMIT_WRITER_PID=$$
_EMIT_WRITER_HOST=$(hostname -s 2>/dev/null || true)
_EMIT_CI_HEARTBEAT_PID=""
_EMIT_DEPLOY_HEARTBEAT_PID=""

ci_init() {
  _EMIT_CI_TOTAL=$1
  _EMIT_CI_STEP=0
  _EMIT_SHA=$(git rev-parse HEAD)
  _EMIT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
  _EMIT_MSG=$(git log -1 --format="%s" HEAD 2>/dev/null || true)
  _EMIT_MSG="${_EMIT_MSG//\"/\\\"}"
  _EMIT_STARTED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  _EMIT_STARTED_EPOCH=$(date +%s)
  if mkdir -p ".ci-logs" 2>/dev/null; then
    _EMIT_LOG_FILE=".ci-logs/${_EMIT_SHA}.log"
    _emit_start_log "$_EMIT_LOG_FILE"
  fi
  _emit_write_atomic \
    "$(printf '{"status":"running","sha":"%s","branch":"%s","startedAt":"%s","progress":{"step":0,"total":%d,"pct":0,"label":"starting"},"writer":{"pid":%d,"host":"%s","heartbeatAt":"%s"}}' \
      "$_EMIT_SHA" "$_EMIT_BRANCH" "$_EMIT_STARTED" "$_EMIT_CI_TOTAL" \
      "$_EMIT_WRITER_PID" "$_EMIT_WRITER_HOST" "$_EMIT_STARTED")" \
    .ci-status.json
  _emit_start_heartbeat ci
}

ci_step() {
  _EMIT_CI_STEP=$((_EMIT_CI_STEP + 1))
  local pct=$((_EMIT_CI_STEP * 100 / _EMIT_CI_TOTAL))
  _emit_write_atomic \
    "$(printf '{"status":"running","sha":"%s","branch":"%s","startedAt":"%s","progress":{"step":%d,"total":%d,"pct":%d,"label":"%s"},"writer":{"pid":%d,"host":"%s","heartbeatAt":"%s"}}' \
      "$_EMIT_SHA" "$_EMIT_BRANCH" "$_EMIT_STARTED" \
      "$_EMIT_CI_STEP" "$_EMIT_CI_TOTAL" "$pct" "$1" \
      "$_EMIT_WRITER_PID" "$_EMIT_WRITER_HOST" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")")" \
    .ci-status.json
}

ci_done() {
  [[ "$_EMIT_CI_FINALIZED" == "1" ]] && return 0
  _EMIT_CI_FINALIZED=1
  _emit_stop_heartbeat ci

  local completed_at
  completed_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local duration=$(( $(date +%s) - _EMIT_STARTED_EPOCH ))
  _EMIT_CI_DURATION=$duration

  _emit_write_atomic \
    "$(printf '{"status":"%s","sha":"%s","branch":"%s","completedAt":"%s"}' \
      "$1" "$_EMIT_SHA" "$_EMIT_BRANCH" "$completed_at")" \
    .ci-status.json

  printf '{"status":"%s","sha":"%s","branch":"%s","startedAt":"%s","completedAt":"%s","durationSec":%d,"message":"%s"}\n' \
    "$1" "$_EMIT_SHA" "$_EMIT_BRANCH" "$_EMIT_STARTED" "$completed_at" "$duration" "$_EMIT_MSG" >> .ci-history.jsonl

  _emit_truncate_history .ci-history.jsonl
  [[ -d ".ci-logs" ]] && _emit_rotate_logs .ci-logs
  _emit_flush_log
}

deploy_init() {
  _EMIT_DEPLOY_TOTAL=$1
  _EMIT_LAUNCH_MODE="${2:-interactive}"
  _EMIT_LAUNCH_MARKER="${3:-}"
  _EMIT_DEPLOY_STEP=0
  _EMIT_SHA=$(git rev-parse HEAD)
  _EMIT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
  _EMIT_MSG=$(git log -1 --format="%s" HEAD 2>/dev/null || true)
  _EMIT_MSG="${_EMIT_MSG//\"/\\\"}"
  _EMIT_STARTED=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  _EMIT_STARTED_EPOCH=$(date +%s)
  if mkdir -p ".deploy-logs" 2>/dev/null; then
    _EMIT_DEPLOY_LOG_FILE=".deploy-logs/${_EMIT_SHA}.log"
    _emit_start_log "$_EMIT_DEPLOY_LOG_FILE"
  fi
  _emit_write_atomic \
    "$(printf '{"status":"deploying","sha":"%s","branch":"%s","startedAt":"%s","progress":{"step":0,"total":%d,"pct":0,"label":"starting"},"launch":{"mode":"%s","marker":"%s"},"writer":{"pid":%d,"host":"%s","heartbeatAt":"%s"}}' \
      "$_EMIT_SHA" "$_EMIT_BRANCH" "$_EMIT_STARTED" "$_EMIT_DEPLOY_TOTAL" \
      "$_EMIT_LAUNCH_MODE" "$_EMIT_LAUNCH_MARKER" \
      "$_EMIT_WRITER_PID" "$_EMIT_WRITER_HOST" "$_EMIT_STARTED")" \
    .deploy-status.json
  _emit_start_heartbeat deploy
}

deploy_step() {
  _EMIT_DEPLOY_STEP=$((_EMIT_DEPLOY_STEP + 1))
  _EMIT_DEPLOY_LABEL="$1"
  local pct=$((_EMIT_DEPLOY_STEP * 100 / _EMIT_DEPLOY_TOTAL))
  _emit_write_atomic \
    "$(printf '{"status":"deploying","sha":"%s","branch":"%s","startedAt":"%s","progress":{"step":%d,"total":%d,"pct":%d,"label":"%s"},"launch":{"mode":"%s","marker":"%s"},"writer":{"pid":%d,"host":"%s","heartbeatAt":"%s"}}' \
      "$_EMIT_SHA" "$_EMIT_BRANCH" "$_EMIT_STARTED" \
      "$_EMIT_DEPLOY_STEP" "$_EMIT_DEPLOY_TOTAL" "$pct" "$1" \
      "$_EMIT_LAUNCH_MODE" "$_EMIT_LAUNCH_MARKER" \
      "$_EMIT_WRITER_PID" "$_EMIT_WRITER_HOST" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")")" \
    .deploy-status.json
}

# Per-image progress within the current step (sprint 339). A build/retag step
# can sit unchanged for tens of minutes while several images build one after
# another (a tastease deploy sat at "Building + pushing images" for ~38min
# across 4 images with no way to tell progress from a stall) — this doesn't
# advance _EMIT_DEPLOY_STEP itself, it just names which image is in flight and
# its position within the step so the dashboard can show that instead.
deploy_image_progress() {
  local name="$1" index="$2" total="$3" action="$4"
  local pct=$((_EMIT_DEPLOY_STEP * 100 / _EMIT_DEPLOY_TOTAL))
  _emit_write_atomic \
    "$(printf '{"status":"deploying","sha":"%s","branch":"%s","startedAt":"%s","progress":{"step":%d,"total":%d,"pct":%d,"label":"%s","image":{"name":"%s","index":%d,"total":%d,"action":"%s"}},"launch":{"mode":"%s","marker":"%s"},"writer":{"pid":%d,"host":"%s","heartbeatAt":"%s"}}' \
      "$_EMIT_SHA" "$_EMIT_BRANCH" "$_EMIT_STARTED" \
      "$_EMIT_DEPLOY_STEP" "$_EMIT_DEPLOY_TOTAL" "$pct" "$_EMIT_DEPLOY_LABEL" \
      "$name" "$index" "$total" "$action" \
      "$_EMIT_LAUNCH_MODE" "$_EMIT_LAUNCH_MARKER" \
      "$_EMIT_WRITER_PID" "$_EMIT_WRITER_HOST" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")")" \
    .deploy-status.json
}

deploy_done() {
  [[ "$_EMIT_DEPLOY_FINALIZED" == "1" ]] && return 0
  _EMIT_DEPLOY_FINALIZED=1
  _emit_stop_heartbeat deploy

  _emit_close_phase
  local completed_at
  completed_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local duration=$(( $(date +%s) - _EMIT_STARTED_EPOCH ))

  # isBuildBaseline is always true here: deploy_done only ever runs after the
  # hook's build/retag phase for every declared service (pre-push:174-229) —
  # unlike a CLI-direct deploy, this path can't reach "deployed" without
  # having really built or re-tagged the images for $_EMIT_SHA. See sprint
  # 336 / resolve_last_deployed_sha (deploy-launch.sh) for why this flag
  # exists and what happens when it's absent.
  _emit_write_atomic \
    "$(printf '{"status":"%s","sha":"%s","branch":"%s","completedAt":"%s","launch":{"mode":"%s","marker":"%s"},"isBuildBaseline":true}' \
      "$1" "$_EMIT_SHA" "$_EMIT_BRANCH" "$completed_at" "$_EMIT_LAUNCH_MODE" "$_EMIT_LAUNCH_MARKER")" \
    .deploy-status.json

  printf '{"status":"%s","sha":"%s","branch":"%s","startedAt":"%s","completedAt":"%s","durationSec":%d,"servicesBuilt":%s,"phases":%s,"launch":{"mode":"%s","marker":"%s"},"message":"%s","isBuildBaseline":true}\n' \
    "$1" "$_EMIT_SHA" "$_EMIT_BRANCH" "$_EMIT_STARTED" "$completed_at" "$duration" "$(_emit_services_json)" "$(_emit_phases_json)" "$_EMIT_LAUNCH_MODE" "$_EMIT_LAUNCH_MARKER" "$_EMIT_MSG" >> .deploy-history.jsonl

  _emit_truncate_history .deploy-history.jsonl
  [[ -d ".deploy-logs" ]] && _emit_rotate_logs .deploy-logs
  _emit_flush_log
}
