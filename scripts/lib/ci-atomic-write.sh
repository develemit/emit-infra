# ci-atomic-write.sh — atomic status-file writes, history trimming, and the
# services-built JSON fragment.
#
#   _emit_write_atomic <content> <dest> [tmp]  -> write via tmp+mv (no partial reads)
#   _emit_truncate_history <file>              -> keep only the newest 500 lines past 1000
#   _emit_services_json                        -> echoes _EMIT_SERVICES_BUILT as a JSON array
#   deploy_set_services <svc...>               -> record which services this deploy built
#
# _emit_write_atomic takes content/dest as plain args (no module state).
# _emit_services_json/deploy_set_services read/write _EMIT_SERVICES_BUILT
# (declared in ci-utils.sh). Sourced by ci-utils.sh — see that file for the
# shared module state.

[[ -n "${_EMIT_CI_ATOMIC_WRITE_LOADED:-}" ]] && return 0
_EMIT_CI_ATOMIC_WRITE_LOADED=1

_emit_write_atomic() {
  local content="$1" dest="$2" tmp="${3:-${2}.tmp}"
  printf '%s\n' "$content" > "$tmp" && mv "$tmp" "$dest"
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
