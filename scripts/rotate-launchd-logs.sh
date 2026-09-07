#!/usr/bin/env bash
# rotate-launchd-logs.sh — size-cap the files launchd itself writes via
# StandardOutPath/StandardErrorPath. Sprint 324.
#
# The supervisor already rotates the log it mirrors into one level down
# (_svsup_rotate_log, scripts/lib/serve-supervised-lib.sh), but the file
# launchd owns above that has no cap at all — it grows for the lifetime of
# the agent. Reuses the same copytruncate helper: copy the tail to an
# archive, then truncate the live file in place with `: > "$file"` so
# launchd's open StandardOutPath fd keeps writing to the same inode.
# Renaming the file out from under launchd does NOT work — the daemon keeps
# its fd pointed at the old (now-unlinked) inode and the new file stays
# empty forever. See docs/DEV-SERVER-SUPERVISOR.md.
#
# Usage:
#   scripts/rotate-launchd-logs.sh [--log <path>]... [--max-bytes <n>] [--max-keep <n>]
#
#   --log <path>       A log file to check. Repeatable. Defaults to the three
#                       known unbounded agent logs (below) when omitted.
#   --max-bytes <n>    Size threshold to trigger rotation (default: 5MB, same
#                       cap the supervisor uses for its own log)
#   --max-keep <n>     Archives kept per log, oldest deleted first (default: 5)
#
# Meant to run hourly via com.emit.log-rotate.plist (StartInterval), but safe
# to run standalone or by hand.
set -uo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
SELF_DIR="$(dirname "$SELF")"
source "$SELF_DIR/lib/ci-log-capture.sh"
source "$SELF_DIR/lib/serve-supervised-lib.sh"

_rotate_launchd_logs_usage() {
  sed -n '2,20p' "$SELF"
}

_rotate_launchd_default_logs() {
  local log_dir="$HOME/.local/log"
  echo "$log_dir/emit-infra-launchd.log"
  echo "$log_dir/develemit-hq-launchd.log"
  echo "$log_dir/metrics-collector.log"
}

# Archive dir is a sibling directory named after the log's own basename, same
# convention serve-supervised.sh uses for its per-agent archive (log_dir/NAME).
_rotate_launchd_archive_dir() {
  local file="$1" dir base
  dir="$(dirname "$file")"
  base="$(basename "$file" .log)"
  echo "$dir/$base"
}

main() {
  local max_bytes=$((5 * 1024 * 1024))
  local max_keep=5
  local logs=()

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --log) logs+=("$2"); shift 2 ;;
      --max-bytes) max_bytes="$2"; shift 2 ;;
      --max-keep) max_keep="$2"; shift 2 ;;
      -h|--help) _rotate_launchd_logs_usage; return 0 ;;
      *) echo "rotate-launchd-logs: unknown flag '$1'" >&2; return 2 ;;
    esac
  done

  if [[ ${#logs[@]} -eq 0 ]]; then
    while IFS= read -r line; do logs+=("$line"); done < <(_rotate_launchd_default_logs)
  fi

  local file archive_dir
  for file in "${logs[@]}"; do
    archive_dir="$(_rotate_launchd_archive_dir "$file")"
    _svsup_rotate_log "$file" "$max_bytes" "$archive_dir" "$max_keep"
  done
}

# Sourceable for unit tests (rotate-launchd-logs.test.sh) without running
# main — same guard idiom as serve-supervised.sh / dev-stack-watchdog.sh.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
