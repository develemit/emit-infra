# ci-phase-tracking.sh — per-phase timing for deploy_done's "phases" JSON.
#
#   deploy_phase <name>          -> start timing a phase; closes the previous one
#   deploy_record_phase <name> <sec>  -> record a phase timed elsewhere (e.g. ci)
#   _emit_close_phase            -> close the currently-open phase, if any
#   _emit_phases_json            -> echoes the accumulated phases as a JSON object
#
# Reads/writes _EMIT_PHASES, _EMIT_PHASE_NAME, _EMIT_PHASE_EPOCH (declared in
# ci-utils.sh). Sourced by ci-utils.sh — see that file for the shared module
# state. deploy_done calls _emit_close_phase to close the final phase before
# writing the terminal record.

[[ -n "${_EMIT_CI_PHASE_TRACKING_LOADED:-}" ]] && return 0
_EMIT_CI_PHASE_TRACKING_LOADED=1

deploy_record_phase() {
  local name="${1//\"/}" sec="$2"
  [[ -n "$_EMIT_PHASES" ]] && _EMIT_PHASES+=","
  _EMIT_PHASES+="$(printf '"%s":%d' "$name" "$sec")"
}

_emit_close_phase() {
  [[ -n "$_EMIT_PHASE_NAME" ]] || return 0
  deploy_record_phase "$_EMIT_PHASE_NAME" "$(( $(date +%s) - _EMIT_PHASE_EPOCH ))"
  _EMIT_PHASE_NAME=""
}

# Start timing a phase; closes the previous one. deploy_done closes the last.
deploy_phase() {
  _emit_close_phase
  _EMIT_PHASE_NAME="${1//\"/}"
  _EMIT_PHASE_EPOCH=$(date +%s)
}

_emit_phases_json() { printf '{%s}\n' "$_EMIT_PHASES"; }
