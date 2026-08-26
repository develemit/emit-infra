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
#     -- <command...>
#
#   --name <slug>       Identifies this server in logs and death records
#   --health-url <url>  Polled every --interval seconds
#   --dir <path>        Where .server-deaths.jsonl is written (default: cwd)
#   --interval <s>      Seconds between health probes (default: 5)
#   --failures <n>      Consecutive failed probes before treating as dead (default: 3)
#   --max-restarts <n>  Stop restarting after this many consecutive deaths (default: 10)
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
COMMAND=()

MAX_LOG_BYTES=$((5 * 1024 * 1024))
MAX_LOG_ARCHIVES=10
PROBE_TIMEOUT=3

SHUTTING_DOWN=0
CHILD_PID=""
SLEEP_PID=""

die() { echo "✗ serve-supervised: $*" >&2; exit 1; }
usage() { sed -n '2,21p' "$SELF"; }

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --name) NAME="$2"; shift 2 ;;
      --health-url) HEALTH_URL="$2"; shift 2 ;;
      --dir) DIR="$2"; shift 2 ;;
      --interval) INTERVAL="$2"; shift 2 ;;
      --failures) FAILURES="$2"; shift 2 ;;
      --max-restarts) MAX_RESTARTS="$2"; shift 2 ;;
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
    _svsup_rotate_log "$log_file" "$MAX_LOG_BYTES" "$archive_dir" "$MAX_LOG_ARCHIVES"

    "${COMMAND[@]}" &
    CHILD_PID=$!
    local start_epoch fail_count death_reason death_exit death_sig
    start_epoch=$(date +%s)
    fail_count=0
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
      else
        fail_count=$((fail_count + 1))
        [[ $fail_count -ge $FAILURES ]] && { death_reason="health-timeout"; break; }
      fi

      _svsup_rotate_log "$log_file" "$MAX_LOG_BYTES" "$archive_dir" "$MAX_LOG_ARCHIVES"
    done

    [[ $SHUTTING_DOWN -eq 1 ]] && break

    local uptime=$(( $(date +%s) - start_epoch ))

    if [[ "$death_reason" == "health-timeout" ]]; then
      echo "✗ [$NAME] health probe failed $FAILURES times in a row — killing and restarting"
      _svsup_kill_tree "$CHILD_PID" TERM
      _svsup_wait_tree_gone "$CHILD_PID" 30 || _svsup_kill_tree "$CHILD_PID" KILL
      wait "$CHILD_PID" 2>/dev/null
      death_exit=$?
      [[ $death_exit -gt 128 ]] && death_sig=$((death_exit - 128))
    else
      echo "✗ [$NAME] process exited (code $death_exit) — restarting"
      _svsup_kill_tree "$CHILD_PID" TERM
    fi

    _svsup_wait_port_free "$health_host" "$health_port" 50 || true

    _svsup_append_death "$deaths_file" "$NAME" "$death_reason" "$death_exit" "$death_sig" \
      "$uptime" "$restart_count" "$CHILD_PID" "$host_short" "$log_file"

    restart_count=$((restart_count + 1))
    if [[ $restart_count -ge $MAX_RESTARTS ]]; then
      _svsup_print_banner "$NAME" "$MAX_RESTARTS" "$deaths_file"
      _emit_flush_log
      exit 1
    fi

    local backoff
    backoff=$(_svsup_backoff_seconds "$((restart_count - 1))" 60)
    echo "→ [$NAME] restarting in ${backoff}s (restart $restart_count/$MAX_RESTARTS)"
    sleep "$backoff"
  done

  echo "→ [$NAME] supervisor exiting cleanly"
  _emit_flush_log
  exit 0
}

# Sourceable for unit tests (serve-supervised.test.sh) without running main —
# same guard idiom as deploy-detached.sh.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  main "$@"
fi
