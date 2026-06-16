#!/usr/bin/env bash
# Flip all projects between GitHub Actions CI and local CI scripts.
#
# Usage:
#   ./scripts/ci-mode.sh            # show current status
#   ./scripts/ci-mode.sh local      # disable all GH workflows → run locally
#   ./scripts/ci-mode.sh github     # re-enable all GH workflows
#
# Billing check requires the 'user' gh scope. Add it once with:
#   gh auth refresh -h github.com -s user
set -euo pipefail

ORG=develemit

# "repo:workflow1:workflow2" — one entry per repo
ENTRIES=(
  "diner_decider:CI:Deploy"
  "develemail:CI:Deploy"
  "easyliving:CI:Deploy"
  "martialops:CI"
  "emit-vision:CI:Deploy Staging:Deploy"
)

LOCAL_PROJECTS=(
  "diner-decider"
  "develemail"
  "tastease"
  "martialops"
  "emit-vision"
)

# ── billing check ──────────────────────────────────────────────────────────────
check_minutes() {
  local raw
  raw=$(gh api /users/develemit/settings/billing/usage 2>/dev/null || true)
  if [[ -z "$raw" ]]; then
    echo "  minutes: (unavailable)"
    return
  fi
  python3 - "$raw" <<'EOF'
import sys, json
from datetime import datetime

raw = sys.argv[1]
try:
    data = json.loads(raw)
except Exception:
    print("  minutes: (could not parse billing response)")
    sys.exit(0)

items = data.get("usageItems", [])
month = datetime.utcnow().strftime("%Y-%m")
FREE_MINUTES = 2000

# Sum Linux minutes for current month, grouped by repo
per_repo: dict[str, float] = {}
for item in items:
    if not item.get("date", "").startswith(month):
        continue
    if item.get("sku") == "Actions Linux" and item.get("unitType") == "Minutes":
        repo = item.get("repositoryName", "unknown")
        per_repo[repo] = per_repo.get(repo, 0) + item.get("quantity", 0)

total = int(sum(per_repo.values()))
remaining = FREE_MINUTES - total

if remaining <= 0:
    print(f"  minutes: {total} / {FREE_MINUTES} used — OUT OF BUDGET (resets 1st of month)")
else:
    print(f"  minutes: {total} / {FREE_MINUTES} used — {remaining} remaining")

if per_repo:
    top = sorted(per_repo.items(), key=lambda x: x[1], reverse=True)
    for repo, mins in top:
        print(f"    {int(mins):>5} min  {repo}")
EOF
}

# ── workflow state for one repo ────────────────────────────────────────────────
workflow_state() {
  local repo=$1 wf=$2
  gh workflow list --repo "$ORG/$repo" --json name,state 2>/dev/null \
    | python3 -c "
import sys, json
wfs = json.load(sys.stdin)
wf = '${wf}'.lower()
match = next((w for w in wfs if w['name'].lower() == wf), None)
print(match['state'] if match else 'not found')
" 2>/dev/null || echo "error"
}

# ── status ─────────────────────────────────────────────────────────────────────
show_status() {
  echo "── GitHub Actions billing ────────────────────────────────────────────────"
  check_minutes
  echo ""
  echo "── Workflow states ───────────────────────────────────────────────────────"
  for entry in "${ENTRIES[@]}"; do
    IFS=':' read -ra parts <<< "$entry"
    local repo="${parts[0]}"
    echo "  $ORG/$repo:"
    for i in "${!parts[@]}"; do
      [[ $i -eq 0 ]] && continue
      local wf="${parts[$i]}"
      local state
      state=$(workflow_state "$repo" "$wf")
      printf "    %-10s %s\n" "$wf" "$state"
    done
  done
  echo ""
  echo "── Local CI status ───────────────────────────────────────────────────────"
  for name in "${LOCAL_PROJECTS[@]}"; do
    local dir="$HOME/projects/$name"
    local status_file="$dir/.ci-status.json"
    if [[ -f "$status_file" ]]; then
      local info
      info=$(python3 - "$status_file" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
status = d.get('status', '?')
sha = d.get('sha', '')[:8]
ts = d.get('completedAt', d.get('startedAt', ''))
p = d.get('progress') or {}
label = p.get('label', '')
pct = p.get('pct', '')
suffix = f" · {label} {pct}%" if label and status == 'running' else ''
print(f"{sha:<8}  {status}{suffix}  {ts}")
EOF
)
      printf "  %-16s %s\n" "$name" "$info"
    else
      printf "  %-16s %s\n" "$name" "(no local CI run — cd ~/projects/$name && ./scripts/ci.sh)"
    fi
  done
}

# ── disable all (switch to local) ─────────────────────────────────────────────
use_local() {
  echo "→ disabling GitHub Actions workflows"
  for entry in "${ENTRIES[@]}"; do
    IFS=':' read -ra parts <<< "$entry"
    local repo="${parts[0]}"
    for i in "${!parts[@]}"; do
      [[ $i -eq 0 ]] && continue
      local wf="${parts[$i]}"
      echo "  $ORG/$repo / $wf"
      gh workflow disable "$wf" --repo "$ORG/$repo" 2>/dev/null \
        || echo "  (skipped — already disabled or not found)"
    done
  done
  echo ""
  echo "✓ Workflows disabled. Per-project commands:"
  echo "  ./scripts/ci.sh      — checks + writes .ci-status.json (shows in develemit-hq)"
  echo "  ./scripts/deploy.sh  — build, push, deploy"
}

# ── enable all (switch back to GitHub) ────────────────────────────────────────
use_github() {
  echo "→ checking minutes before enabling"
  check_minutes
  echo ""
  echo "→ enabling GitHub Actions workflows"
  for entry in "${ENTRIES[@]}"; do
    IFS=':' read -ra parts <<< "$entry"
    local repo="${parts[0]}"
    for i in "${!parts[@]}"; do
      [[ $i -eq 0 ]] && continue
      local wf="${parts[$i]}"
      echo "  $ORG/$repo / $wf"
      gh workflow enable "$wf" --repo "$ORG/$repo" 2>/dev/null \
        || echo "  (skipped — already enabled or not found)"
    done
  done
  echo ""
  echo "✓ Workflows enabled. Next push to main triggers GitHub CI."
}

# ── dispatch ──────────────────────────────────────────────────────────────────
case "${1:-status}" in
  local)   use_local  ;;
  github)  use_github ;;
  status)  show_status ;;
  *)
    echo "Usage: $0 [status|local|github]"
    exit 1
    ;;
esac
