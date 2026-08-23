# ci-signals.sh — INT/TERM/HUP handling so an interrupted ci/deploy phase
# doesn't leave its status file frozen at "running"/"deploying" (sprint 282).
#
#   _emit_trap_signals <ci|deploy>    -> install INT/TERM/HUP handlers for the phase
#   _emit_untrap_signals             -> remove them when the phase ends normally
#   _emit_reraise <sig>               -> restore default disposition and re-send <sig>
#   _emit_ci_signal_handler <sig>     -> ci_done failure, then re-raise
#   _emit_deploy_signal_handler <sig> -> deploy_done interrupted, then re-raise
#
# INT/TERM/HUP can arrive mid-build — e.g. an agent's background shell torn
# down mid-deploy. Neither fires the ERR trap `_fail_deploy` installs in
# pre-push, and the process is simply gone before any `on_fail` callback can
# run, so without this the status file freezes at "running"/"deploying"
# forever (2026-08-19 emit-social incident). SIGKILL can't be trapped at all;
# that gap is closed separately by sprint 283's liveness metadata, not here.
#
# `ci_done`/`deploy_done` (ci-utils.sh) guard themselves against a second call
# via the `_EMIT_*_FINALIZED` flags, so a signal that lands just after a
# normal completion is a harmless no-op instead of a duplicate history line.
# Calling them here is a forward reference — fine at runtime since a trap
# fires long after sourcing completes, by which point ci-utils.sh has fully
# defined them.

[[ -n "${_EMIT_CI_SIGNALS_LOADED:-}" ]] && return 0
_EMIT_CI_SIGNALS_LOADED=1

_emit_reraise() {
  trap - INT TERM HUP
  kill -s "$1" "$$"
}

_emit_ci_signal_handler() {
  ci_done failure
  _emit_reraise "$1"
}

_emit_deploy_signal_handler() {
  deploy_done interrupted
  _emit_reraise "$1"
}

# Install INT/TERM/HUP handlers for the given phase ("ci" or "deploy"). Call
# _emit_untrap_signals when the phase ends normally so a signal during the
# *next* phase doesn't fire this phase's writer.
_emit_trap_signals() {
  local kind="$1" fn sig
  case "$kind" in
    ci) fn=_emit_ci_signal_handler ;;
    deploy) fn=_emit_deploy_signal_handler ;;
    *) echo "_emit_trap_signals: unknown kind '$kind'" >&2; return 1 ;;
  esac
  for sig in INT TERM HUP; do
    trap "$fn $sig" "$sig"
  done
}

_emit_untrap_signals() {
  trap - INT TERM HUP
}
