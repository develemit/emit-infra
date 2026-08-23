# ci-log-capture.sh — mirror a ci/deploy run's stdout/stderr to a log file and
# rotate old logs.
#
#   _emit_start_log <file>          -> start mirroring stdout/stderr into <file>
#   _emit_flush_log                 -> restore stdout/stderr, wait for the mirror to drain
#   _emit_rotate_logs <dir> [max]   -> delete oldest logs in <dir> past [max] (default 100)
#
# Reads/writes only _EMIT_TEE_PID (declared in ci-utils.sh). Sourced by
# ci-utils.sh — see that file for the shared module state.

[[ -n "${_EMIT_CI_LOG_CAPTURE_LOADED:-}" ]] && return 0
_EMIT_CI_LOG_CAPTURE_LOADED=1

# Mirror stdout/stderr to a log file via a background tee we can wait on.
# A plain `exec > >(tee ...)` loses buffered output when the script exits
# right after a failure (bash doesn't wait for process substitutions, and
# $! isn't set for them on bash 3.2), truncating the log at the failing step.
_emit_start_log() {
  local file="$1" fifo
  fifo=$(mktemp -u "${TMPDIR:-/tmp}/emit-log.XXXXXX") || return 0
  mkfifo "$fifo" 2>/dev/null || return 0
  tee -a "$file" < "$fifo" &
  _EMIT_TEE_PID=$!
  exec 3>&1 4>&2 > "$fifo" 2>&1
  rm -f "$fifo"
}

# Restore stdout/stderr and wait for tee to drain so the log is complete.
_emit_flush_log() {
  [[ -n "$_EMIT_TEE_PID" ]] || return 0
  exec 1>&3 2>&4 3>&- 4>&-
  wait "$_EMIT_TEE_PID" 2>/dev/null || true
  _EMIT_TEE_PID=""
}

_emit_rotate_logs() {
  local dir="$1" max="${2:-100}"
  local count
  count=$(ls -t "$dir"/*.log 2>/dev/null | wc -l)
  if [[ $count -gt $max ]]; then
    ls -t "$dir"/*.log 2>/dev/null | tail -n +"$((max + 1))" | xargs rm -f
  fi
}
