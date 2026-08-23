# ci-heartbeat.sh — writer liveness heartbeat (sprint 283).
#
#   _emit_start_heartbeat <ci|deploy>   -> fork a background refresher, store its pid
#   _emit_stop_heartbeat <ci|deploy>    -> kill + reap the refresher, if one is running
#   _emit_refresh_heartbeat <file>      -> rewrite just the file's "heartbeatAt" field
#
# Reads/writes _EMIT_CI_HEARTBEAT_PID/_EMIT_DEPLOY_HEARTBEAT_PID (declared in
# ci-utils.sh) and calls _emit_write_atomic (ci-atomic-write.sh). Sourced by
# ci-utils.sh — see that file for the shared module state.

[[ -n "${_EMIT_CI_HEARTBEAT_LOADED:-}" ]] && return 0
_EMIT_CI_HEARTBEAT_LOADED=1

# A deploy has long silent stretches (an emulated linux/amd64 image build can
# run minutes between deploy_step calls), so "last write time" alone would
# misreport an active build as orphaned. A background refresher rewrites just
# the "heartbeatAt" field on an interval so a reader can tell "no update in
# 5 minutes" from "still building." It reads the file rather than rebuilding
# it from in-process state, since it runs in a forked subshell that only has
# a frozen snapshot of variables from the moment _emit_start_heartbeat ran —
# reading the file picks up whatever the latest deploy_step/ci_step wrote.
_emit_refresh_heartbeat() {
  local file="$1" content ts
  [[ -f "$file" ]] || return 0
  content=$(cat "$file") || return 0
  case "$content" in
    *'"writer":'*) ;;
    *) return 0 ;; # terminal record already written — nothing to refresh
  esac
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  content=$(printf '%s' "$content" | sed -E 's/"heartbeatAt":"[^"]*"/"heartbeatAt":"'"$ts"'"/')
  # A distinct tmp name from the main writer's "${file}.tmp" — deploy_step/
  # ci_step run in the foreground process while this runs in a background
  # subshell, so sharing one tmp path would let the two racily stomp each
  # other's in-flight write (last mv wins, the other fails with "No such
  # file or directory"). Different tmp names mean at worst the *destination*
  # write race is a lost update, self-healing at the next tick — never a
  # missing/corrupt file.
  _emit_write_atomic "$content" "$file" "${file}.hb.tmp"
}

# Start a background refresher for the given phase's status file. Checks its
# parent is still alive every 5s (so a `kill -9` of the hook is noticed
# quickly even though SIGKILL can't be trapped) and refreshes the heartbeat
# every 30s. Stores the refresher's pid in the phase-specific global so
# _emit_stop_heartbeat can reap it.
_emit_start_heartbeat() {
  local kind="$1" file parent=$$
  case "$kind" in
    ci) file=.ci-status.json ;;
    deploy) file=.deploy-status.json ;;
    *) echo "_emit_start_heartbeat: unknown kind '$kind'" >&2; return 1 ;;
  esac
  (
    while :; do
      for _ in 1 2 3 4 5 6; do
        kill -0 "$parent" 2>/dev/null || exit 0
        sleep 5
      done
      kill -0 "$parent" 2>/dev/null || exit 0
      _emit_refresh_heartbeat "$file"
    done
  ) &
  if [[ "$kind" == "ci" ]]; then _EMIT_CI_HEARTBEAT_PID=$!; else _EMIT_DEPLOY_HEARTBEAT_PID=$!; fi
}

# Stop the refresher for the given phase, if one is running. Safe to call
# even when none was started (e.g. a phase that never got past _init).
_emit_stop_heartbeat() {
  local kind="$1" pid
  if [[ "$kind" == "ci" ]]; then pid="$_EMIT_CI_HEARTBEAT_PID"; _EMIT_CI_HEARTBEAT_PID=""
  else pid="$_EMIT_DEPLOY_HEARTBEAT_PID"; _EMIT_DEPLOY_HEARTBEAT_PID=""
  fi
  [[ -n "$pid" ]] || return 0
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}
