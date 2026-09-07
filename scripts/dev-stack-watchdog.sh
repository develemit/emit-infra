#!/usr/bin/env bash
# dev-stack-watchdog.sh — probes a dev stack's health endpoint on an interval
# and kickstarts its launchd job once it's been unreachable for several
# consecutive probes. Sprint 322.
#
# launchd's KeepAlive only watches the top of the caffeinate -> pnpm dev ->
# nx -> serve-supervised.sh chain: the API supervisor can exit (an external
# SIGTERM, sprint 321's "signalled" reason) while pnpm dev and the dashboard
# keep running, and launchd sees a live job forever. The same argument
# serve-supervised.sh makes one level down — a process check isn't enough,
# only a health probe catches it — applies one level up. See
# docs/DEV-SERVER-SUPERVISOR.md.
#
# Usage:
#   scripts/dev-stack-watchdog.sh [--url <health-url>] [--label <launchd-label>]
#     [--threshold <n>] [--ceiling <n>] [--state-dir <dir>] [--log-file <path>]
#
#   --url <url>        Health endpoint to probe (default: http://127.0.0.1:${PORT:-7001}/health)
#   --label <label>    launchd job label to kickstart (default: com.emit.infra)
#   --threshold <n>    Consecutive failed probes before acting (default: 3)
#   --ceiling <n>      Max kickstarts allowed per rolling hour (default: 3)
#   --state-dir <dir>  Where the failure counter and kickstart history live
#                       (default: ~/.local/state/dev-stack-watchdog)
#   --log-file <path>  Where kickstart/give-up lines are logged
#                       (default: ~/.local/log/dev-stack-watchdog.log)
#
# Meant to run every ~120s via com.emit.dev-stack-watchdog.plist (StartInterval),
# but safe to run standalone or by hand. Never fights a deliberate
# `pnpm launch:stop`: if launchd doesn't have the job loaded, that's treated
# as an intentional stop, not a crash, and the watchdog clears its state and
# does nothing.
set -uo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
SELF_DIR="$(dirname "$SELF")"
source "$SELF_DIR/lib/serve-supervised-lib.sh"

_watchdog_usage() {
  sed -n '2,25p' "$SELF"
}

# Whether launchd has <label> loaded right now. Kickstarting an unloaded job
# would fight a deliberate `launchctl bootout` (pnpm launch:stop) — this is
# the only question that distinguishes "crashed" from "stopped on purpose".
_watchdog_job_loaded() {
  local label="$1" uid
  uid="$(id -u)"
  launchctl print "gui/${uid}/${label}" >/dev/null 2>&1
}

_watchdog_kickstart() {
  local label="$1" uid
  uid="$(id -u)"
  launchctl kickstart -k "gui/${uid}/${label}" >/dev/null 2>&1
}

_watchdog_log() {
  local log_file="$1" msg="$2"
  mkdir -p "$(dirname "$log_file")"
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$msg" >> "$log_file"
}

_watchdog_read_count() {
  local file="$1"
  [[ -f "$file" ]] && cat "$file" 2>/dev/null || echo 0
}

_watchdog_write_count() {
  local file="$1" n="$2"
  mkdir -p "$(dirname "$file")"
  printf '%s' "$n" > "$file"
}

# Kickstart-timestamps file: one unix-epoch-seconds line per action taken.
# Pruned to the trailing <window_s> on every read, so the ceiling check needs
# no separate cleanup pass. Always leaves the file present (possibly empty)
# so callers don't need to special-case "never written".
_watchdog_prune_kickstarts() {
  local file="$1" window_s="$2" now cutoff kept
  now=$(date +%s)
  cutoff=$((now - window_s))
  mkdir -p "$(dirname "$file")"
  if [[ -f "$file" ]]; then
    kept=$(awk -v cutoff="$cutoff" '$1 ~ /^[0-9]+$/ && $1 >= cutoff' "$file")
  else
    kept=""
  fi
  if [[ -n "$kept" ]]; then
    printf '%s\n' "$kept" > "$file"
  else
    : > "$file"
  fi
  wc -l < "$file" | tr -d ' '
}

_watchdog_record_kickstart() {
  local file="$1"
  mkdir -p "$(dirname "$file")"
  date +%s >> "$file"
}

main() {
  local url="http://127.0.0.1:${PORT:-7001}/health"
  local label="com.emit.infra"
  local threshold=3
  local ceiling=3
  local state_dir="${HOME}/.local/state/dev-stack-watchdog"
  local log_file="${HOME}/.local/log/dev-stack-watchdog.log"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --url) url="$2"; shift 2 ;;
      --label) label="$2"; shift 2 ;;
      --threshold) threshold="$2"; shift 2 ;;
      --ceiling) ceiling="$2"; shift 2 ;;
      --state-dir) state_dir="$2"; shift 2 ;;
      --log-file) log_file="$2"; shift 2 ;;
      -h|--help) _watchdog_usage; return 0 ;;
      *) echo "dev-stack-watchdog: unknown flag '$1'" >&2; return 2 ;;
    esac
  done

  local count_file="$state_dir/${label}.count"
  local kickstart_file="$state_dir/${label}.kickstarts"

  if _svsup_probe_health "$url" 3; then
    _watchdog_write_count "$count_file" 0
    return 0
  fi

  local count
  count=$(_watchdog_read_count "$count_file")
  count=$((count + 1))
  _watchdog_write_count "$count_file" "$count"

  if ! _watchdog_job_loaded "$label"; then
    # Unloaded means `pnpm launch:stop` ran on purpose — never restart that.
    _watchdog_write_count "$count_file" 0
    return 0
  fi

  [[ $count -ge $threshold ]] || return 0

  local recent_kickstarts
  recent_kickstarts=$(_watchdog_prune_kickstarts "$kickstart_file" 3600)
  if [[ $recent_kickstarts -ge $ceiling ]]; then
    _watchdog_log "$log_file" \
      "give up: $label unhealthy at $url after $count consecutive probes, but $recent_kickstarts kickstart(s) already in the last hour (ceiling $ceiling) — not restarting"
    return 1
  fi

  _watchdog_kickstart "$label"
  _watchdog_record_kickstart "$kickstart_file"
  _watchdog_write_count "$count_file" 0
  _watchdog_log "$log_file" \
    "kickstarted $label after $count consecutive failed probes of $url"
}

# Sourceable for unit tests (dev-stack-watchdog.test.sh) without running
# main — same guard idiom as serve-supervised.sh / deploy-detached.sh.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
