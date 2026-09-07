#!/usr/bin/env bash
# Tests for scripts/rotate-launchd-logs.sh (sprint 324).
# Run: bash scripts/lib/rotate-launchd-logs.test.sh
set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROTATOR="$LIB_DIR/../rotate-launchd-logs.sh"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ok   $1"; }
no() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else no "$1 (want '$3', got '$2')"; fi; }

_inode() { stat -f %i "$1" 2>/dev/null || stat -c %i "$1" 2>/dev/null; }

echo "bash -n is clean"
if bash -n "$ROTATOR"; then ok "bash -n clean"; else no "bash -n clean"; fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

source "$ROTATOR"

echo
echo "log over the cap: archived and truncated, inode unchanged"
BIG_LOG="$WORK/agent-launchd.log"
printf '%200s' | tr ' ' 'x' > "$BIG_LOG"
BEFORE_INODE="$(_inode "$BIG_LOG")"
main --log "$BIG_LOG" --max-bytes 100 --max-keep 5
AFTER_INODE="$(_inode "$BIG_LOG")"
check "archive directory has one file" "$(ls "$WORK/agent-launchd" 2>/dev/null | wc -l | tr -d ' ')" "1"
check "live file is empty after rotation" "$(wc -c < "$BIG_LOG" | tr -d ' ')" "0"
check "the live file's inode is unchanged (launchd's fd stays valid)" "$AFTER_INODE" "$BEFORE_INODE"

echo
echo "log under the cap: left alone, no archive dir created"
SMALL_LOG="$WORK/small-launchd.log"
printf 'hello' > "$SMALL_LOG"
main --log "$SMALL_LOG" --max-bytes 100 --max-keep 5
check "small log is untouched" "$(cat "$SMALL_LOG")" "hello"
check "no archive dir was created for it" "$([[ -d "$WORK/small-launchd" ]] && echo yes || echo no)" "no"

echo
echo "repeated rotations: archive dir caps at max-keep, oldest deleted first"
CAP_LOG="$WORK/cap-launchd.log"
printf '%200s' | tr ' ' 'x' > "$CAP_LOG"
for i in 1 2 3 4 5; do
  main --log "$CAP_LOG" --max-bytes 100 --max-keep 2
  printf '%200s' | tr ' ' 'y' >> "$CAP_LOG"
done
check "archive dir caps at max-keep" "$(ls "$WORK/cap-launchd" | wc -l | tr -d ' ')" "2"

echo
echo "default log list points at the three known agent logs"
DEFAULTS="$(_rotate_launchd_default_logs)"
check "emit-infra-launchd.log is in the default list" "$(echo "$DEFAULTS" | grep -c 'emit-infra-launchd.log$')" "1"
check "develemit-hq-launchd.log is in the default list" "$(echo "$DEFAULTS" | grep -c 'develemit-hq-launchd.log$')" "1"
check "metrics-collector.log is in the default list" "$(echo "$DEFAULTS" | grep -c 'metrics-collector.log$')" "1"

echo
echo "== $PASS passed, $FAIL failed =="
[[ $FAIL -eq 0 ]]
