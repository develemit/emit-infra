# serve-supervised-lib.sh — process-tree, health-probe, log-rotation, and
# death-record helpers for scripts/serve-supervised.sh (sprint 310).
#
#   _svsup_tree_pids <pid>                        -> echo <pid> + every descendant
#   _svsup_kill_tree <pid> [sig]                 -> signal <pid> and every descendant
#   _svsup_wait_pids_gone <timeout-ds> <pid...>   -> poll until all are gone
#   _svsup_parse_host_port <url>                  -> echoes "<host> <port>"
#   _svsup_wait_port_free <host> <port> [timeout-ds] -> poll until nothing answers
#   _svsup_lsof_bin                               -> path to lsof (not on launchd's PATH)
#   _svsup_kill_port_holders <host> <port>        -> SIGKILL whatever still listens
#   _svsup_hold_active <file> [max-age-s]         -> is the hold file being refreshed?
#   _svsup_probe_health <url> [timeout-s]         -> curl the health endpoint
#   _svsup_rotate_log <file> <max-bytes> <archive-dir> <max-keep>
#   _svsup_append_death <deaths-file> <name> <reason> <exit> <sig> <uptime>
#                        <restarts> <pid> <host> <log-file>
#   _svsup_backoff_seconds <attempt> [cap]        -> 1,2,4,8… capped at [cap]
#
# Pure enough to unit-test in isolation (serve-supervised.test.sh sources
# this directly without pulling in the CLI's arg parsing / main loop).

[[ -n "${_SVSUP_LIB_LOADED:-}" ]] && return 0
_SVSUP_LIB_LOADED=1

# Echo <pid> and every descendant, leaves first. Callers must snapshot the
# tree BEFORE signalling it: the instant a parent exits its children are
# reparented to pid 1, and `pgrep -P` can no longer reach them from the
# original root.
_svsup_tree_pids() {
  local pid="$1" child
  [[ -n "$pid" ]] || return 0
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    _svsup_tree_pids "$child"
  done
  echo "$pid"
}

# Kill <pid> and every descendant, leaves first. tsx --watch's real process
# is a grandchild (watcher -> server), so killing just the top pid can leave
# the actual listener running and the restart hits EADDRINUSE.
_svsup_kill_tree() {
  local pid="$1" sig="${2:-TERM}" child
  [[ -n "$pid" ]] || return 0
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    _svsup_kill_tree "$child" "$sig"
  done
  kill -s "$sig" "$pid" 2>/dev/null || true
}

# Poll until every pid in "$@" is gone. Waiting on the root pid alone is not
# enough — it is the reparented grandchild holding the port that blocks the
# next start, and it outlives the root by definition.
_svsup_wait_pids_gone() {
  local timeout_ds="$1"; shift
  local i=0 pid alive
  while [[ $i -lt $timeout_ds ]]; do
    alive=0
    for pid in "$@"; do
      if kill -0 "$pid" 2>/dev/null; then alive=1; break; fi
    done
    [[ $alive -eq 0 ]] && return 0
    sleep 0.1
    i=$((i + 1))
  done
  return 1
}

_svsup_parse_host_port() {
  python3 -c "
import sys, urllib.parse as u
p = u.urlparse(sys.argv[1])
host = p.hostname or '127.0.0.1'
port = p.port or (443 if p.scheme == 'https' else 80)
print(host, port)
" "$1"
}

# Poll until <host>:<port> stops accepting connections — restarting before
# the old listener's socket is actually released hands the new process
# EADDRINUSE. Not fatal if it never clears within the ceiling: the caller
# proceeds anyway and the next health-timeout cycle will catch a genuinely
# stuck port.
_svsup_wait_port_free() {
  local host="$1" port="$2" timeout_ds="${3:-50}" i=0
  while [[ $i -lt $timeout_ds ]]; do
    nc -z -w 1 "$host" "$port" >/dev/null 2>&1 || return 0
    sleep 0.1
    i=$((i + 1))
  done
  return 1
}

# On macOS lsof ships in /usr/sbin, which is absent from the PATH launchd
# hands a LaunchAgent — and this script runs under one. Resolve it by path
# rather than trusting PATH, or the port-holder reap silently no-ops in
# exactly the environment it exists for.
_svsup_lsof_bin() {
  local candidate
  for candidate in /usr/sbin/lsof /usr/bin/lsof /opt/homebrew/bin/lsof /usr/local/bin/lsof; do
    [[ -x "$candidate" ]] && { echo "$candidate"; return 0; }
  done
  command -v lsof 2>/dev/null
}

# Last resort when the port is still held after the tree teardown: SIGKILL
# whatever is listening on it. A grandchild that reparented to pid 1 mid-kill
# keeps the socket, and every subsequent start then dies instantly — on
# EADDRINUSE, or for `next dev` on "Another next dev server is already
# running" — until something reaps it. Loopback only; a health URL pointing
# at a real host is never ours to kill.
_svsup_kill_port_holders() {
  local host="$1" port="$2" lsof_bin pids pid
  case "$host" in
    127.0.0.1|localhost|::1|0.0.0.0) ;;
    *) return 0 ;;
  esac
  lsof_bin=$(_svsup_lsof_bin) || return 0
  [[ -n "$lsof_bin" ]] || return 0
  pids=$("$lsof_bin" -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null)
  [[ -n "$pids" ]] || return 0
  for pid in $pids; do
    echo "  killing orphaned listener pid $pid on $host:$port"
    kill -9 "$pid" 2>/dev/null || true
  done
}

# True while <file> exists and was touched within <max-age> seconds. The
# supervised process refreshes it only while it is doing work that must not
# be interrupted, so staleness doubles as a liveness signal: a wedged process
# stops refreshing and the hold lapses on its own, with no extra probe.
_svsup_hold_active() {
  local file="$1" max_age="${2:-30}" mtime now
  [[ -n "$file" && -f "$file" ]] || return 1
  mtime=$(stat -f %m "$file" 2>/dev/null || stat -c %Y "$file" 2>/dev/null) || return 1
  [[ -n "$mtime" ]] || return 1
  now=$(date +%s)
  [[ $((now - mtime)) -le $max_age ]]
}

_svsup_probe_health() {
  local url="$1" timeout_s="${2:-3}"
  curl -fsS -o /dev/null -m "$timeout_s" "$url" 2>/dev/null
}

# Copytruncate rotation: archive a copy, then truncate the live file in
# place rather than renaming it out from under the running tee. tee -a
# opens with O_APPEND, which always seeks to end-of-file before writing, so
# a truncate-in-place is picked up correctly on the very next write with no
# need to stop/restart the mirror — reopening it would race the still-live
# child process, which keeps its original fd pointed at the old file.
# Reuses _emit_rotate_logs (ci-log-capture.sh) to cap the archive count,
# same convention as .ci-logs/.deploy-logs.
_SVSUP_ROTATE_SEQ=0

_svsup_rotate_log() {
  local file="$1" max_bytes="$2" archive_dir="$3" max_keep="${4:-10}" size
  [[ -f "$file" ]] || return 0
  size=$(wc -c < "$file" 2>/dev/null | tr -d ' ')
  [[ -n "$size" ]] || return 0
  [[ "$size" -gt "$max_bytes" ]] || return 0
  mkdir -p "$archive_dir" 2>/dev/null
  # PID + monotonic per-process counter suffix: ISO-8601 seconds resolution
  # alone lets two rotations in the same wall-clock second (same process,
  # back-to-back) silently overwrite one archive with the next.
  _SVSUP_ROTATE_SEQ=$((_SVSUP_ROTATE_SEQ + 1))
  cp "$file" "$archive_dir/$(basename "$file" .log)-$(date -u +%Y%m%dT%H%M%SZ)-$$-${_SVSUP_ROTATE_SEQ}.log" 2>/dev/null
  : > "$file"
  _emit_rotate_logs "$archive_dir" "$max_keep"
}

# Append one JSON line to <deaths-file>. Built with python3's json.dumps
# (not printf) because lastOutput is arbitrary program output — quotes,
# backslashes, unicode — and a printf-assembled string would produce
# invalid JSON on the first death whose log line contains a stray quote.
_svsup_append_death() {
  local deaths_file="$1" name="$2" reason="$3" exit_code="$4" signal="$5" \
        uptime="$6" restart_count="$7" pid="$8" host="$9" log_file="${10}"
  python3 - "$deaths_file" "$name" "$reason" "$exit_code" "$signal" \
    "$uptime" "$restart_count" "$pid" "$host" "$log_file" <<'PYEOF'
import json, sys, datetime

deaths_file, name, reason, exit_code, signal, uptime, restart_count, pid, host, log_file = sys.argv[1:11]

def to_int(v):
    try:
        return int(v)
    except (ValueError, TypeError):
        return None

last_output = ""
try:
    with open(log_file, errors="replace") as f:
        last_output = "".join(f.readlines()[-40:])
except OSError:
    pass

record = {
    "ts": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
    "name": name,
    "reason": reason,
    "exitCode": to_int(exit_code),
    "signal": signal or None,
    "uptimeSec": to_int(uptime) or 0,
    "restartCount": to_int(restart_count) or 0,
    "pid": to_int(pid),
    "host": host,
    "lastOutput": last_output,
}

with open(deaths_file, "a") as f:
    f.write(json.dumps(record) + "\n")
PYEOF
}

_svsup_backoff_seconds() {
  local attempt="$1" cap="${2:-60}" val
  val=$((1 << attempt))
  [[ $val -gt $cap ]] && val=$cap
  echo "$val"
}
