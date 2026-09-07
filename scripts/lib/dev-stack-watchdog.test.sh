#!/usr/bin/env bash
# Tests for scripts/dev-stack-watchdog.sh (sprint 322).
# Run: bash scripts/lib/dev-stack-watchdog.test.sh
set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WATCHDOG="$LIB_DIR/../dev-stack-watchdog.sh"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ok   $1"; }
no() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else no "$1 (want '$3', got '$2')"; fi; }

echo "bash -n is clean"
if bash -n "$WATCHDOG"; then ok "bash -n clean"; else no "bash -n clean"; fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Stub externals BEFORE sourcing: bash resolves a bare command name against
# shell functions before PATH, so these override curl/launchctl for every
# call the script makes — including through _svsup_probe_health, which the
# script reuses rather than calling curl itself. Same shape as docker() in
# docker-build.test.sh / pnpm() in deploy-plan.test.sh.
CURL_RC=0
curl() { return "$CURL_RC"; }

LAUNCHCTL_LOADED=1
KICKSTART_CALLS="$WORK/kickstart-calls"
: > "$KICKSTART_CALLS"
launchctl() {
  case "$1" in
    print) [[ "$LAUNCHCTL_LOADED" == "1" ]] ;;
    kickstart) echo "$*" >> "$KICKSTART_CALLS"; return 0 ;;
    *) return 0 ;;
  esac
}

source "$WATCHDOG"

STATE_DIR="$WORK/state"
LOG_FILE="$WORK/watchdog.log"
LABEL="com.test.watchdog"
URL="http://127.0.0.1:9/health"

run_watchdog() {
  main --url "$URL" --label "$LABEL" --threshold 3 --ceiling 3 \
    --state-dir "$STATE_DIR" --log-file "$LOG_FILE"
}

count_file() { echo "$STATE_DIR/${LABEL}.count"; }

reset_state() {
  rm -rf "$STATE_DIR" "$LOG_FILE"
  : > "$KICKSTART_CALLS"
}

echo
echo "healthy probe: no action, counter reset"
reset_state
CURL_RC=0
run_watchdog
check "count file reads 0" "$(_watchdog_read_count "$(count_file)")" "0"
check "no kickstart calls" "$(cat "$KICKSTART_CALLS")" ""
check "no log line written" "$([[ -s "$LOG_FILE" ]] && echo yes || echo no)" "no"

echo
echo "N-1 consecutive failures: no action"
reset_state
CURL_RC=1
run_watchdog
run_watchdog
check "count after 2 failures is 2" "$(_watchdog_read_count "$(count_file)")" "2"
check "no kickstart yet" "$(cat "$KICKSTART_CALLS")" ""

echo
echo "Nth consecutive failure: exactly one kickstart"
run_watchdog
check "kickstart called once" "$(wc -l < "$KICKSTART_CALLS" | tr -d ' ')" "1"
check "counter reset after kickstart" "$(_watchdog_read_count "$(count_file)")" "0"
check "a log line was written" "$([[ -s "$LOG_FILE" ]] && echo yes || echo no)" "yes"

echo
echo "job unloaded (launch:stop): no action even past threshold"
reset_state
LAUNCHCTL_LOADED=0
CURL_RC=1
for _ in 1 2 3 4 5; do run_watchdog; done
check "no kickstart while unloaded" "$(cat "$KICKSTART_CALLS")" ""
check "counter stays cleared while unloaded" "$(_watchdog_read_count "$(count_file)")" "0"
LAUNCHCTL_LOADED=1

echo
echo "ceiling reached: no kickstart, one give-up log line"
reset_state
KS_FILE="$STATE_DIR/${LABEL}.kickstarts"
mkdir -p "$STATE_DIR"
now=$(date +%s)
printf '%s\n%s\n%s\n' "$now" "$now" "$now" > "$KS_FILE"
CURL_RC=1
run_watchdog
run_watchdog
run_watchdog
check "ceiling blocks the kickstart" "$(cat "$KICKSTART_CALLS")" ""
check "give-up line logged" "$(grep -c 'give up' "$LOG_FILE" 2>/dev/null || echo 0)" "1"

echo
echo "== $PASS passed, $FAIL failed =="
[[ $FAIL -eq 0 ]]
