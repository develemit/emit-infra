#!/usr/bin/env bash
# Tests for the fleet-pulse role's emit-fleet-pulse script (sprint 360).
# Run: bash scripts/lib/fleet-pulse.test.sh
#
# The script is an Ansible template; the only Jinja is three `{{ ... }}`
# defaults, so it is rendered with sed and run as a subprocess with a fake
# `curl` on PATH that logs every call and answers health checks per FAKE_HEALTH_CODE.
set -uo pipefail

TEMPLATE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/ansible/roles/fleet-pulse/templates/emit-fleet-pulse.sh.j2"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ok   $1"; }
no() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else no "$1 (want '$3', got '$2')"; fi; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"
CALL_LOG="$WORK/curl.log"
export CALL_LOG

sed -e 's/{{ project_name }}/demo/g' -e 's#{{ fleet_pulse_health_url }}#https://demo.test/health#' "$TEMPLATE" > "$WORK/pulse.sh"

cat > "$WORK/bin/curl" <<'FAKE'
#!/usr/bin/env bash
for arg in "$@"; do
  case "$arg" in
    https://demo.test/health) echo "${FAKE_HEALTH_CODE:-200}"; exit 0 ;;
    https://pulse.test/*) echo "$arg" >> "$CALL_LOG"; exit 0 ;;
  esac
done
exit 0
FAKE
chmod +x "$WORK/bin/curl"

echo "EMIT_VISION_INGEST_KEY=k" > "$WORK/env"

iso_ago() { # seconds ago, UTC ISO
  date -u -d "@$(( $(date -u +%s) - $1 ))" +%FT%TZ 2>/dev/null || date -u -r "$(( $(date -u +%s) - $1 ))" +%FT%TZ
}

run_pulse() {
  : > "$CALL_LOG"
  PATH="$WORK/bin:$PATH" ENV_FILE="$WORK/env" PULSE_BASE=https://pulse.test \
    BACKUP_STATUS_FILE="$WORK/status.json" BACKUP_PING_STATE="$WORK/ping-state" \
    bash "$WORK/pulse.sh" 2>/dev/null
}
calls() { tr '\n' ' ' < "$CALL_LOG" | sed 's/ $//'; }

rm -f "$WORK/status.json" "$WORK/ping-state"

echo "health"
FAKE_HEALTH_CODE=200 run_pulse
check "200 pings uptime success" "$(calls)" "https://pulse.test/demo-uptime"
FAKE_HEALTH_CODE=503 run_pulse
check "503 pings uptime /fail" "$(calls)" "https://pulse.test/demo-uptime/fail"
FAKE_HEALTH_CODE=000 run_pulse
check "unreachable pings uptime /fail" "$(calls)" "https://pulse.test/demo-uptime/fail"

echo "backup"
run_pulse
check "no status file: no backup ping" "$(calls)" "https://pulse.test/demo-uptime"

echo "{\"lastRun\":\"$(iso_ago 3600)\",\"status\":\"ok\"}" > "$WORK/status.json"
rm -f "$WORK/ping-state"; run_pulse
check "ok and fresh: backup success" "$(calls)" "https://pulse.test/demo-uptime https://pulse.test/demo-backup"

run_pulse
check "second run within the hour: no backup ping" "$(calls)" "https://pulse.test/demo-uptime"

echo "{\"lastRun\":\"$(iso_ago 3600)\",\"status\":\"failed\"}" > "$WORK/status.json"
rm -f "$WORK/ping-state"; run_pulse
check "failed: backup /fail" "$(calls)" "https://pulse.test/demo-uptime https://pulse.test/demo-backup/fail"

echo "{\"lastRun\":\"$(iso_ago 200000)\",\"status\":\"ok\"}" > "$WORK/status.json"
rm -f "$WORK/ping-state"; run_pulse
check "stale (>26h): backup /fail" "$(calls)" "https://pulse.test/demo-uptime https://pulse.test/demo-backup/fail"

echo $(( $(date -u +%s) - 4000 )) > "$WORK/ping-state"
run_pulse
check "pinged over an hour ago: pings again" "$(calls)" "https://pulse.test/demo-uptime https://pulse.test/demo-backup/fail"

echo "$PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
