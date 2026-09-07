#!/usr/bin/env bash
# serve-supervised.sh — keep a long-lived dev server alive by probing its
# health endpoint (not its process), restarting it with backoff when it
# stops answering, and recording every death as structured JSONL. See
# sprint 310 / docs/DEV-SERVER-SUPERVISOR.md.
#
# Why a process check isn't enough: `tsx --watch` doesn't restart a child
# that exits — it idles waiting for the next file change. The supervisor
# process stays alive, holds no listening socket, has zero children, and
# looks perfectly healthy in `ps`. Only a probe of the actual health
# endpoint catches that.
#
# Usage:
#   scripts/serve-supervised.sh --name <slug> --health-url <url>
#     [--dir <path>] [--interval <s>] [--failures <n>] [--max-restarts <n>]
#     [--probe-timeout <s>] [--hold-file <path>] [--hold-stale <s>] [--hold-max <s>]
#     -- <command...>
#
#   --name <slug>        Identifies this server in logs and death records
#   --health-url <url>   Polled every --interval seconds
#   --dir <path>         Where .server-deaths.jsonl is written (default: cwd)
#   --interval <s>       Seconds between health probes (default: 5)
#   --failures <n>       Consecutive failed probes before treating as dead (default: 3)
#   --max-restarts <n>   Stop restarting after this many consecutive deaths (default: 10)
#   --probe-timeout <s>  Per-probe curl timeout (default: 3)
#   --hold-file <path>   If fresh, defer a health-timeout restart (default: none).
#                        Relative paths resolve against --dir.
#   --hold-stale <s>     How new --hold-file must be to count as held (default: 30)
#   --hold-max <s>       Longest a single unhealthy episode may be deferred (default: 900)
set -uo pipefail

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
SELF_DIR="$(dirname "$SELF")"
source "$SELF_DIR/lib/ci-log-capture.sh"
source "$SELF_DIR/lib/serve-supervised-lib.sh"

: "${NAME:=}"
: "${HEALTH_URL:=}"
: "${DIR:=}"
: "${INTERVAL:=5}"
: "${FAILURES:=3}"
: "${MAX_RESTARTS:=10}"
: "${PROBE_TIMEOUT:=3}"
: "${HOLD_FILE:=}"
: "${HOLD_STALE:=30}"
: "${HOLD_MAX:=900}"
COMMAND=()

MAX_LOG_BYTES=$((5 * 1024 * 1024))
MAX_LOG_ARCHIVES=10

# Epoch second the current unhealthy episode started being deferred; 0 when
# not deferring. Global because _svsup_defer_restart is called from the probe
# loop and has to persist across ticks.
hold_since=0

SHUTTING_DOWN=0
CHILD_PID=""
SLEEP_PID=""
CHILD_ACTIVE=0
start_epoch=0
SVSUP_SIGNAL_NAME=""
SVSUP_SIGNAL_CONTEXT=""

die() { echo "✗ serve-supervised: $*" >&2; exit 1; }
usage() { sed -n '2,29p' "$SELF"; }

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --name) NAME="$2"; shift 2 ;;
      --health-url) HEALTH_URL="$2"; shift 2 ;;
      --dir) DIR="$2"; shift 2 ;;
      --interval) INTERVAL="$2"; shift 2 ;;
      --failures) FAILURES="$2"; shift 2 ;;
      --max-restarts) MAX_RESTARTS="$2"; shift 2 ;;
      --probe-timeout) PROBE_TIMEOUT="$2"; shift 2 ;;
      --hold-file) HOLD_FILE="$2"; shift 2 ;;
      --hold-stale) HOLD_STALE="$2"; shift 2 ;;
      --hold-max) HOLD_MAX="$2"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      --) shift; COMMAND=("$@"); return 0 ;;
      *) die "unknown argument '$1' (see --help)" ;;
    esac
  done
}

# Ctrl-C / a normal stop must not read as a death: forward the signal to the
# child tree, mark shutdown so the main loop exits without restarting, and
# record nothing. Installed with the same `trap "fn sig" sig` idiom as
# ci-signals.sh's _emit_trap_signals.
_svsup_handle_signal() {
  local sig="$1"
  SHUTTING_DOWN=1
  SVSUP_SIGNAL_NAME="$sig"
  # Best-effort: identify who sent this later. Must not block or error — a
  # signal handler that hangs on ps or trips `set -u` never gets to forward
  # the signal to the child.
  SVSUP_SIGNAL_CONTEXT="$(ps -o pid=,ppid=,command= -p "$PPID" 2>/dev/null)"
  echo "→ [$NAME] received SIG$sig — forwarding to child, exiting without restart"
  [[ -n "$CHILD_PID" ]] && _svsup_kill_tree "$CHILD_PID" "$sig"
  [[ -n "$SLEEP_PID" ]] && kill "$SLEEP_PID" 2>/dev/null
}

# Split out from main() so tests can assert INT is wired to the same handler
# as TERM without exercising a real end-to-end `kill -INT` — bash sets
# SIGINT to ignored-by-default for an async (`&`) job launched from a
# non-interactive shell, and POSIX forbids a script from overriding a signal
# that was already ignored on entry, so `kill -INT` from a test's own
# non-interactive shell doesn't reliably test this script's own trap (same
# limitation documented in hook-signals.test.sh for the same reason).
_svsup_install_traps() {
  trap '_svsup_handle_signal INT' INT
  trap '_svsup_handle_signal TERM' TERM
}

# A failed probe means "this server did not answer in $PROBE_TIMEOUT s" — not
# necessarily "this server is dead". A supervised dev server that hosts agent
# sessions gets its event loop starved whenever one of those agents runs a
# heavy job (a full Playwright suite, a build), and killing then takes down
# the very work that caused the stall. So: while the server is still actively
# refreshing its hold file, defer. Staleness ends the hold by itself, and
# HOLD_MAX bounds it so a genuinely wedged server still gets restarted.
_svsup_defer_restart() {
  [[ -n "$HOLD_FILE" ]] || return 1
  _svsup_hold_active "$HOLD_FILE" "$HOLD_STALE" || return 1

  local now; now=$(date +%s)
  if [[ $hold_since -eq 0 ]]; then
    hold_since=$now
    echo "→ [$NAME] health probe failing but $HOLD_FILE is fresh — deferring restart (up to ${HOLD_MAX}s)"
  fi
  if [[ $((now - hold_since)) -ge $HOLD_MAX ]]; then
    echo "✗ [$NAME] deferred ${HOLD_MAX}s and still unhealthy — restarting anyway"
    return 1
  fi
  return 0
}

_svsup_print_banner() {
  local name="$1" max="$2" deaths_file="$3"
  echo ""
  echo "############################################################"
  echo "# [$name] STOPPED — $max consecutive restarts failed to stay healthy."
  echo "# Not retrying automatically. Diagnose, fix, then re-run this"
  echo "# supervisor by hand."
  echo "#   death history: $deaths_file"
  echo "############################################################"
  echo ""
}

main() {
  parse_args "$@"
  [[ -n "$NAME" ]] || die "--name is required"
  [[ -n "$HEALTH_URL" ]] || die "--health-url is required"
  [[ ${#COMMAND[@]} -gt 0 ]] || die "no command given — pass it after '--'"
  [[ -n "$DIR" ]] || DIR="$(pwd)"
  DIR="$(cd "$DIR" 2>/dev/null && pwd)" || die "no such directory: $DIR"
  [[ -n "$HOLD_FILE" && "$HOLD_FILE" != /* ]] && HOLD_FILE="$DIR/$HOLD_FILE"

  local log_dir="$HOME/.local/log"
  mkdir -p "$log_dir"
  local log_file="$log_dir/${NAME}.log"
  local archive_dir="$log_dir/${NAME}"
  local deaths_file="$DIR/.server-deaths.jsonl"
  local host_short
  host_short=$(hostname -s 2>/dev/null || true)

  local health_host health_port
  read -r health_host health_port < <(_svsup_parse_host_port "$HEALTH_URL")

  _emit_start_log "$log_file"
  _svsup_install_traps

  local restart_count=0
  while true; do
    # A signal that lands during the backoff sleep below sets SHUTTING_DOWN
    # after the handler has already killed the (dead) child, so re-check here:
    # spawning one more child on the way out leaks it, and the orphan holds
    # the log pipe open, which hangs this script's own exit.
    [[ $SHUTTING_DOWN -eq 1 ]] && break
    _svsup_rotate_log "$log_file" "$MAX_LOG_BYTES" "$archive_dir" "$MAX_LOG_ARCHIVES"

    "${COMMAND[@]}" &
    CHILD_PID=$!
    CHILD_ACTIVE=1
    local fail_count death_reason death_exit death_sig
    start_epoch=$(date +%s)
    fail_count=0
    hold_since=0
    death_reason=""
    death_exit=""
    death_sig=""
    echo "→ [$NAME] started pid $CHILD_PID (attempt $((restart_count + 1)))"

    while true; do
      sleep "$INTERVAL" &
      SLEEP_PID=$!
      wait "$SLEEP_PID" 2>/dev/null
      SLEEP_PID=""
      [[ $SHUTTING_DOWN -eq 1 ]] && break

      if ! kill -0 "$CHILD_PID" 2>/dev/null; then
        wait "$CHILD_PID" 2>/dev/null
        death_exit=$?
        death_reason="exited"
        [[ $death_exit -gt 128 ]] && death_sig=$((death_exit - 128))
        break
      fi

      if _svsup_probe_health "$HEALTH_URL" "$PROBE_TIMEOUT"; then
        fail_count=0
        restart_count=0
        hold_since=0
      else
        fail_count=$((fail_count + 1))
        if [[ $fail_count -ge $FAILURES ]] && ! _svsup_defer_restart; then
          death_reason="health-timeout"
          break
        fi
      fi

      _svsup_rotate_log "$log_file" "$MAX_LOG_BYTES" "$archive_dir" "$MAX_LOG_ARCHIVES"
    done

    [[ $SHUTTING_DOWN -eq 1 ]] && break

    local uptime=$(( $(date +%s) - start_epoch ))

    # Snapshot before signalling anything: children reparent to pid 1 as soon
    # as their parent exits, so this is the last moment the full tree can be
    # enumerated from the root.
    local tree_pids stray
    tree_pids=$(_svsup_tree_pids "$CHILD_PID")

    if [[ "$death_reason" == "health-timeout" ]]; then
      echo "✗ [$NAME] health probe failed $FAILURES times in a row — killing and restarting"
      _svsup_kill_tree "$CHILD_PID" TERM
      # shellcheck disable=SC2086
      if ! _svsup_wait_pids_gone 30 $tree_pids; then
        echo "→ [$NAME] part of the tree survived SIGTERM — escalating to SIGKILL"
        for stray in $tree_pids; do kill -9 "$stray" 2>/dev/null || true; done
        # shellcheck disable=SC2086
        _svsup_wait_pids_gone 30 $tree_pids || true
      fi
      wait "$CHILD_PID" 2>/dev/null
      death_exit=$?
      [[ $death_exit -gt 128 ]] && death_sig=$((death_exit - 128))
    else
      echo "✗ [$NAME] process exited (code $death_exit) — restarting"
      _svsup_kill_tree "$CHILD_PID" TERM
      # shellcheck disable=SC2086
      _svsup_wait_pids_gone 30 $tree_pids || true
    fi

    if ! _svsup_wait_port_free "$health_host" "$health_port" 50; then
      echo "✗ [$NAME] $health_host:$health_port still held after teardown — killing the listener"
      _svsup_kill_port_holders "$health_host" "$health_port"
      _svsup_wait_port_free "$health_host" "$health_port" 50 || true
    fi

    _svsup_append_death "$deaths_file" "$NAME" "$death_reason" "$death_exit" "$death_sig" \
      "$uptime" "$restart_count" "$CHILD_PID" "$host_short" "$log_file"
    CHILD_ACTIVE=0

    restart_count=$((restart_count + 1))
    if [[ $restart_count -ge $MAX_RESTARTS ]]; then
      _svsup_print_banner "$NAME" "$MAX_RESTARTS" "$deaths_file"
      _emit_flush_log
      exit 1
    fi

    local backoff
    backoff=$(_svsup_backoff_seconds "$((restart_count - 1))" 60)
    echo "→ [$NAME] restarting in ${backoff}s (restart $restart_count/$MAX_RESTARTS)"
    # Tracked in SLEEP_PID like the probe interval so a stop signal cuts the
    # backoff short instead of waiting out up to a full minute.
    sleep "$backoff" &
    SLEEP_PID=$!
    wait "$SLEEP_PID" 2>/dev/null
    SLEEP_PID=""
  done

  # The loop above only ever breaks via one of the three SHUTTING_DOWN guards,
  # so reaching here always means a signal — but guard it anyway rather than
  # rely on that invariant holding forever. This is the single place a
  # signalled exit gets recorded, so it fires exactly once no matter which of
  # the three guards is the one that actually broke the loop.
  if [[ $SHUTTING_DOWN -eq 1 ]]; then
    local sig_uptime=0 sig_pid=""
    if [[ $CHILD_ACTIVE -eq 1 && $start_epoch -gt 0 ]]; then
      sig_uptime=$(( $(date +%s) - start_epoch ))
      sig_pid="$CHILD_PID"
    fi
    _svsup_append_death "$deaths_file" "$NAME" "signalled" "" "$SVSUP_SIGNAL_NAME" \
      "$sig_uptime" "$restart_count" "$sig_pid" "$host_short" "$log_file" "$SVSUP_SIGNAL_CONTEXT"
  fi

  echo "→ [$NAME] supervisor exiting cleanly"
  _emit_flush_log
  exit 0
}

# Sourceable for unit tests (serve-supervised.test.sh) without running main —
# same guard idiom as deploy-detached.sh.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
