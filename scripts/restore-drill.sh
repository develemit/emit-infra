#!/usr/bin/env bash
# restore-drill.sh — monthly proof that every fleet backup restores. Sprint 361.
# Runs `emit-infra backup verify --all` and, on any failure, reports through the
# API's existing POST /push/notify (push + email via notify(), sprint 356/357).
# Installed as com.emit.restore-drill (docs/BACKUP-INVENTORY.md).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$SCRIPT_DIR/../apps/cli/dist/index.js"
API_URL="${EMIT_INFRA_API_URL:-http://127.0.0.1:7001}"

output=$(node "$CLI" backup verify --all 2>&1)
rc=$?
echo "$output"
[[ $rc -eq 0 ]] && exit 0

failed=$(echo "$output" | grep '^✗' | cut -c1-160 | head -5 | paste -sd ';' -)
body="Restore drill failed: ${failed:-see ~/.local/log/restore-drill.log}"
payload=$(node -e 'console.log(JSON.stringify({title:"Backup restore drill failed",body:process.argv[1].slice(0,400),tag:"restore-drill"}))' "$body")
auth=()
[[ -n "${API_SECRET:-}" ]] && auth=(-H "Authorization: Bearer $API_SECRET")
curl -fsS -m 20 -X POST "${auth[@]}" -H 'Content-Type: application/json' -d "$payload" "$API_URL/push/notify" \
  || echo "restore-drill: could not reach $API_URL/push/notify" >&2
exit "$rc"
