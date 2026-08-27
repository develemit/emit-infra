# resource-gate-lib.sh — pure helpers for scripts/resource-gate.sh.
#
#   _rgate_sysctl_bin                          -> path to sysctl (not on launchd's PATH)
#   _rgate_classify_load <load1> <cores>        -> ok|busy|critical from per-core load
#   _rgate_classify_pressure <level>            -> ok|busy|critical from memorystatus level
#   _rgate_worst <state...>                     -> the most severe of the given states
#   _rgate_state_exit <state>                   -> 0|1|2 for ok|busy|critical
#   _rgate_heavy_count                          -> running e2e/test-suite process count
#   _rgate_slot_acquire <dir> <slots> <pid>     -> claim a semaphore slot (echoes path)
#   _rgate_slot_release <file> <pid>            -> release an owned slot
#   _rgate_slot_reap <dir>                      -> drop slots whose owner pid is dead
#
# Same testability convention as serve-supervised-lib.sh: sourced directly by
# resource-gate.test.sh without the CLI's arg parsing.

[[ -n "${_RGATE_LIB_LOADED:-}" ]] && return 0
_RGATE_LIB_LOADED=1

# sysctl lives in /usr/sbin on macOS, which launchd omits from a LaunchAgent's
# PATH — the same trap that silently killed the dashboard's netstat/lsof health
# probes for weeks. Resolve by absolute path, never by name.
_rgate_sysctl_bin() {
  local candidate
  for candidate in /usr/sbin/sysctl /sbin/sysctl /usr/bin/sysctl; do
    [[ -x "$candidate" ]] && { echo "$candidate"; return 0; }
  done
  command -v sysctl 2>/dev/null
}

# Per-core 1-minute load. Thresholds are deliberately loose — load is a blunt
# instrument and the machine runs fine at 0.6/core; the gate exists to catch a
# genuine pile-up, not to make sprints flinch at a busy Chrome tab.
#   < 1.5/core  ok | < 3.0/core  busy | >= 3.0/core  critical
_rgate_classify_load() {
  local load1="$1" cores="$2"
  awk -v l="$load1" -v c="$cores" 'BEGIN {
    if (c < 1) c = 1
    r = l / c
    if (r >= 3.0) print "critical"
    else if (r >= 1.5) print "busy"
    else print "ok"
  }'
}

# kern.memorystatus_vm_pressure_level: 1 = normal, 2 = warn, 4 = critical.
# Unknown values read as ok — a probe we can't interpret must not block work
# (the check subcommand reports probe availability separately).
_rgate_classify_pressure() {
  case "$1" in
    4) echo "critical" ;;
    2) echo "busy" ;;
    *) echo "ok" ;;
  esac
}

_rgate_worst() {
  local state worst="ok"
  for state in "$@"; do
    case "$state" in
      critical) worst="critical" ;;
      busy) [[ "$worst" != "critical" ]] && worst="busy" ;;
    esac
  done
  echo "$worst"
}

_rgate_state_exit() {
  case "$1" in
    ok) return 0 ;;
    busy) return 1 ;;
    *) return 2 ;;
  esac
}

# Full e2e/test suites already running machine-wide. Playwright's runner and
# vitest's pool both show these argv shapes; counting them approximates "how
# many suites are hammering the box right now" without any registry.
_rgate_heavy_count() {
  ps -Ao command= 2>/dev/null | grep -cE "playwright(\.js)? test|vitest(\.mjs)? run|vitest(\.mjs)?$" || true
}

# ── Semaphore ────────────────────────────────────────────────────────────────
# <dir>/slot-N holds the owner's pid. Claims are atomic via noclobber (set -C):
# two concurrent acquirers racing for the same slot file get exactly one
# winner. A slot whose pid is dead is debris from a crashed owner and is
# reclaimed — the same pid-liveness convention the stale-orphan health check
# uses, so a killed sprint can never wedge the gate.

_rgate_slot_reap() {
  local dir="$1" f owner
  [[ -d "$dir" ]] || return 0
  for f in "$dir"/slot-*; do
    [[ -f "$f" ]] || continue
    owner=$(cat "$f" 2>/dev/null)
    [[ -n "$owner" ]] && kill -0 "$owner" 2>/dev/null && continue
    rm -f "$f"
  done
}

_rgate_slot_acquire() {
  local dir="$1" slots="$2" pid="$3" i f
  mkdir -p "$dir" 2>/dev/null || return 1
  _rgate_slot_reap "$dir"
  for ((i = 1; i <= slots; i++)); do
    f="$dir/slot-$i"
    if (set -C; echo "$pid" > "$f") 2>/dev/null; then
      echo "$f"
      return 0
    fi
  done
  return 1
}

_rgate_slot_release() {
  local file="$1" pid="$2" owner
  [[ -f "$file" ]] || return 0
  owner=$(cat "$file" 2>/dev/null)
  [[ "$owner" == "$pid" ]] || return 1
  rm -f "$file"
}
