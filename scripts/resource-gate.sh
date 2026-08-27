#!/usr/bin/env bash
# resource-gate.sh — machine-wide gate for resource-heavy work (full e2e
# suites, sprint children). Two ideas, composable:
#
#   1. A CHECK: is the machine calm enough to start heavy work right now?
#      (per-core load, memory pressure, how many suites already run)
#   2. A SEMAPHORE: at most N heavy jobs of a given tag at once, machine-wide.
#      Slots are pid-owned files; a crashed owner's slot self-reclaims.
#
# Born 2026-08-26: several sprint runners each launched a Playwright suite at
# once, on top of two dev-server supervisors — every child made a locally
# reasonable choice and nobody saw the sum. See docs/RESOURCE-GATE.md.
#
# Usage:
#   scripts/resource-gate.sh check
#   scripts/resource-gate.sh wait    [--timeout <s>] [--interval <s>]
#   scripts/resource-gate.sh acquire <tag> [--slots <n>] [--timeout <s>]
#   scripts/resource-gate.sh release <slot-file>
#   scripts/resource-gate.sh status  [<tag>]
#
#   check    One-shot. Prints one line per signal plus VERDICT. Exit 0 ok /
#            1 busy / 2 critical.
#   wait     Re-run check every --interval (15s) until ok or --timeout (300s).
#            Exit 0 ok; on timeout, exits with the last check's code.
#   acquire  Wait for machine calm AND a free <tag> slot (default 2 slots,
#            override with --slots or GATE_SLOTS). Prints the slot file path —
#            capture it and pass to release. Exit 0 acquired / 1 no slot in
#            time / 2 machine critical.
#   release  Release a slot you own. Safe to skip on crash — dead-pid slots
#            self-reclaim on the next acquire.
#   status   Show current signals and slot occupancy.
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SELF_DIR/lib/resource-gate-lib.sh"

GATE_ROOT="${GATE_ROOT:-/tmp/emit-resource-gate}"
: "${GATE_SLOTS:=2}"

# Slots are owned by the process that CALLED this script, not by this script
# itself — the CLI is a transient subprocess, and pid-liveness reclaim would
# see its own dead pid and free every slot the instant acquire returned.
# Override with GATE_OWNER_PID when the caller manages a longer-lived owner
# (e.g. a sprint child's pid).
: "${GATE_OWNER_PID:=$PPID}"

die() { echo "✗ resource-gate: $*" >&2; exit 2; }
usage() { sed -n '2,31p' "${BASH_SOURCE[0]}"; }

# RGATE_FORCE_* are test seams — deterministic tests can't wait for the host
# to be genuinely loaded.
_load1() {
  if [[ -n "${RGATE_FORCE_LOAD:-}" ]]; then echo "$RGATE_FORCE_LOAD"; return; fi
  local sysctl_bin; sysctl_bin=$(_rgate_sysctl_bin)
  [[ -n "$sysctl_bin" ]] || { echo ""; return; }
  "$sysctl_bin" -n vm.loadavg 2>/dev/null | tr -d '{}' | awk '{print $1}'
}

_cores() {
  if [[ -n "${RGATE_FORCE_CORES:-}" ]]; then echo "$RGATE_FORCE_CORES"; return; fi
  local sysctl_bin; sysctl_bin=$(_rgate_sysctl_bin)
  { [[ -n "$sysctl_bin" ]] && "$sysctl_bin" -n hw.ncpu 2>/dev/null; } || getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1
}

_pressure() {
  if [[ -n "${RGATE_FORCE_PRESSURE:-}" ]]; then echo "$RGATE_FORCE_PRESSURE"; return; fi
  local sysctl_bin; sysctl_bin=$(_rgate_sysctl_bin)
  [[ -n "$sysctl_bin" ]] || { echo ""; return; }
  "$sysctl_bin" -n kern.memorystatus_vm_pressure_level 2>/dev/null
}

_heavy() {
  if [[ -n "${RGATE_FORCE_HEAVY:-}" ]]; then echo "$RGATE_FORCE_HEAVY"; return; fi
  _rgate_heavy_count
}

# Prints the signal lines and a VERDICT line; returns the verdict's exit code.
cmd_check() {
  local load1 cores pressure heavy
  load1=$(_load1); cores=$(_cores); pressure=$(_pressure); heavy=$(_heavy)

  local load_state="ok" pressure_state="ok" heavy_state="ok"
  if [[ -n "$load1" ]]; then
    load_state=$(_rgate_classify_load "$load1" "$cores")
    echo "load: $load1 across $cores cores — $load_state"
  else
    echo "load: unavailable — treating as ok"
  fi
  if [[ -n "$pressure" ]]; then
    pressure_state=$(_rgate_classify_pressure "$pressure")
    echo "memory-pressure: level $pressure — $pressure_state"
  else
    echo "memory-pressure: unavailable — treating as ok"
  fi
  # Two suites already running is exactly the pile-up the semaphore prevents;
  # if they came from outside the gate, checking in on top of them is how the
  # 2026-08-26 starvation happened.
  if [[ "$heavy" -ge 4 ]]; then heavy_state="critical"
  elif [[ "$heavy" -ge 2 ]]; then heavy_state="busy"; fi
  echo "heavy-suites: $heavy running — $heavy_state"

  local verdict; verdict=$(_rgate_worst "$load_state" "$pressure_state" "$heavy_state")
  echo "VERDICT: $verdict"
  _rgate_state_exit "$verdict"
}

cmd_wait() {
  local timeout_s=300 interval_s=15
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --timeout) timeout_s="$2"; shift 2 ;;
      --interval) interval_s="$2"; shift 2 ;;
      *) die "unknown wait argument '$1'" ;;
    esac
  done
  local waited=0 rc
  while true; do
    cmd_check; rc=$?
    [[ $rc -eq 0 ]] && return 0
    if [[ $waited -ge $timeout_s ]]; then
      echo "resource-gate: still not calm after ${waited}s — giving up" >&2
      return $rc
    fi
    echo "resource-gate: machine busy — retrying in ${interval_s}s ($waited/${timeout_s}s)" >&2
    sleep "$interval_s"
    waited=$((waited + interval_s))
  done
}

cmd_acquire() {
  local tag="${1:-}"; shift || true
  [[ -n "$tag" ]] || die "acquire needs a <tag> (e.g. 'e2e')"
  [[ "$tag" =~ ^[A-Za-z0-9_-]+$ ]] || die "tag must be alphanumeric/dash/underscore"
  local slots="$GATE_SLOTS" timeout_s=600 interval_s=15
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --slots) slots="$2"; shift 2 ;;
      --timeout) timeout_s="$2"; shift 2 ;;
      --interval) interval_s="$2"; shift 2 ;;
      *) die "unknown acquire argument '$1'" ;;
    esac
  done

  local dir="$GATE_ROOT/$tag" waited=0 rc slot
  while true; do
    cmd_check >&2; rc=$?
    if [[ $rc -eq 2 ]]; then
      if [[ $waited -ge $timeout_s ]]; then
        echo "resource-gate: machine critical after ${waited}s — not starting '$tag'" >&2
        return 2
      fi
    elif slot=$(_rgate_slot_acquire "$dir" "$slots" "$GATE_OWNER_PID"); then
      # busy (rc=1) still acquires: the semaphore itself is the protection, and
      # a machine that is merely busy will not be helped by queueing forever.
      echo "$slot"
      return 0
    elif [[ $waited -ge $timeout_s ]]; then
      echo "resource-gate: no free '$tag' slot after ${waited}s ($slots max)" >&2
      return 1
    fi
    echo "resource-gate: waiting for '$tag' slot ($waited/${timeout_s}s)" >&2
    sleep "$interval_s"
    waited=$((waited + interval_s))
  done
}

cmd_release() {
  local file="${1:-}"
  [[ -n "$file" ]] || die "release needs the slot file path printed by acquire"
  case "$file" in
    "$GATE_ROOT"/*) ;;
    *) die "refusing to release a path outside $GATE_ROOT" ;;
  esac
  _rgate_slot_release "$file" "$GATE_OWNER_PID" \
    || die "slot $file is not owned by pid ${GATE_OWNER_PID:-$$}"
}

cmd_status() {
  local tag="${1:-}"
  cmd_check || true
  local dir f owner
  for dir in "$GATE_ROOT"/${tag:-*}; do
    [[ -d "$dir" ]] || continue
    _rgate_slot_reap "$dir"
    echo "tag $(basename "$dir"):"
    local found=0
    for f in "$dir"/slot-*; do
      [[ -f "$f" ]] || continue
      owner=$(cat "$f" 2>/dev/null)
      echo "  $(basename "$f") held by pid $owner ($(ps -o command= -p "$owner" 2>/dev/null | cut -c1-70))"
      found=1
    done
    [[ $found -eq 0 ]] && echo "  no slots held"
  done
  return 0
}

case "${1:-}" in
  check) shift; cmd_check ;;
  wait) shift; cmd_wait "$@" ;;
  acquire) shift; cmd_acquire "$@" ;;
  release) shift; cmd_release "$@" ;;
  status) shift; cmd_status "$@" ;;
  -h|--help|"") usage; exit 0 ;;
  *) die "unknown command '${1}' (see --help)" ;;
esac
