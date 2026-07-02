# Sprint 98 — `emit-infra triage` CLI script

**Difficulty:** 3

## Goal

Create `scripts/triage.sh <project-name>` — a single command that prints a complete, structured diagnostic snapshot of a project to stdout. Designed to be the first thing a Claude Code session runs when investigating an issue.

## Reason

A Claude Code session investigating a production issue currently has to make 6–8 separate API calls or file reads to piece together the picture. `triage` gives it everything in one shot: current health, last deploy, CI health, recent errors, backup state, and disk/memory trends. No API dependency — reads files directly, so it works even if the dashboard API is down.

## Context

All data lives in `~/projects/<name>/` as flat files written by existing tooling:

| File | Contents |
|------|----------|
| `.metrics.jsonl` | 5-min samples: cpu, mem, disk, nginx4xx, nginx5xx, containers[{name,restarts}] |
| `.deploy-history.jsonl` | Deploy runs: status, sha, branch, startedAt, durationSec, servicesBuilt, message? |
| `.ci-history.jsonl` | CI runs: status, sha, branch, startedAt, durationSec, message? |
| `.deploy-status.json` | Current deploy state (running / deployed / failed) |
| `.ci-status.json` | Current CI state |
| `.backup-status.json` | `{ lastRun, status }` — written by backup cron |
| `.emit-infra.json` | Project config: domain, github.repo, serverIp, etc. |

The script should NOT require `curl`, `jq`, or the API to be running. Use `python3 -c` for JSON parsing (available on macOS, same pattern as `collect-metrics.sh`).

Output format (plain text, color via ANSI escape codes, works in any terminal):

```
━━━ emit-vision triage ━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Domain   api.emit-vision.com
  Repo     emitdutcher/emit-vision

── Current status (from .ci-status.json / .deploy-status.json) ──
  CI       success  abc1234  main  (2h ago)
  Deploy   deployed def5678  main  (3h ago)

── Last 5 deploys ────────────────────────────────
  ✓ def5678  main  2m14s  "fix: memory leak in worker"      3h ago
  ✓ abc1234  main  2m01s  "feat: add /healthz route"         1d ago
  ...

── CI health (last 20 runs) ──────────────────────
  Pass rate  18/20 (90%)   Avg  1m42s

── Latest metrics ────────────────────────────────
  CPU   12%   Mem  71% (+0.3%/day → full ~180d)
  Disk  61%   (+0.4%/day → full ~97d)
  Nginx  4xx: 0   5xx: 2

── Containers ────────────────────────────────────
  api       cpu=2%  mem=312MB  restarts=0
  worker    cpu=1%  mem=180MB  restarts=3  ← restarts > 0
  postgres  cpu=0%  mem=95MB   restarts=0

── Backup ────────────────────────────────────────
  Last run  2026-06-26T02:00Z  (32h ago)  status: ok
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Highlight issues in yellow/red: restarts > 0, 5xx > 0, backup age > 25h, disk > 80%, memory > 85%.

## Tasks

1. Create `scripts/triage.sh`. Start with `#!/usr/bin/env bash` + `set -euo pipefail`.
2. Accept `$1` as project name; derive `PROJECT_DIR="$HOME/projects/$1"`. Validate it exists and has `.emit-infra.json`.
3. Read config fields (domain, github.repo) with `python3 -c "import json; ..."`.
4. Read and format each section: current status, last 5 deploys, CI health (last 20), latest metric point, containers, backup.
5. For "latest metrics": read the last non-error line from `.metrics.jsonl` with `tail -n 50 | grep -v '"error"' | tail -1`.
6. For CI pass rate: `tail -n 20 .ci-history.jsonl` → count lines where status is "success".
7. For memory/disk trend: compute slope from last 48h of metrics using `awk` (same formula as `history.ts` disk-trend endpoint — slope = (n*ΣXY - ΣX*ΣY) / (n*ΣX² - (ΣX)²) then × 86400 for per-day rate).
8. Add ANSI color: `RED='\033[0;31m'`, `YELLOW='\033[0;33m'`, `GREEN='\033[0;32m'`, `NC='\033[0m'`. Use `printf` not `echo -e`.
9. Make executable: `chmod +x scripts/triage.sh`.
10. Test against at least one real project: `scripts/triage.sh emit-vision` (or whichever project has data).

## Files involved

- (new) `scripts/triage.sh` — the triage script

## Acceptance criteria

- [x] `scripts/triage.sh <project>` runs without error when the project directory exists
- [x] Output includes: domain/repo, current CI+deploy status, last 5 deploys with SHA+message, CI pass rate (last 20), latest CPU/mem/disk metrics with trend projections, container list with restart counts, backup age+status
- [x] Containers with restarts > 0 are highlighted
- [x] 5xx count > 0, disk > 80%, memory > 85%, backup age > 25h are highlighted
- [x] Script exits non-zero with a clear error if the project directory doesn't exist
- [x] No dependency on the dashboard API being running

## Completed

**Date:** 2026-06-28

### Summary
Created `scripts/triage.sh` as a standalone bash + python3 script (no jq/curl/API dependency). Accepts a project name, validates the directory exists and has `.emit-infra.json`, then prints seven sections: header (domain/repo), current CI+deploy status, last 5 deploys with SHA/branch/duration/message/age, CI pass rate for last 20 runs with avg duration, latest metrics (CPU/mem/disk with 48h linear-regression trend projections, nginx 4xx/5xx), container list with restart highlighting, and backup status. ANSI color thresholds: 5xx > 0 → red; disk > 80% → red, > 75% → yellow; mem > 85% → red, > 75% → yellow; backup age > 49h → red, > 25h → yellow; CI pass rate < 70% → red, < 90% → yellow. Script exits 1 with a clear error message for missing projects.

### Files changed
- (new) `scripts/triage.sh` — diagnostic triage script

### Verification
- `bash -n scripts/triage.sh`: syntax ok
- `scripts/triage.sh nonexistent-project`: exits 1 with clear error
- `scripts/triage.sh emit-vision`: full output rendered correctly — showed CI status, 5 deploys, 19/20 CI pass rate, metrics with mem trend, all 9 containers, nginx 4xx count

### Follow-ups
- none

## Out of scope

- HTTP health check (requires API or curl to the live domain)
- Log tail / recent error extraction (those require API or SSH)
- Machine-readable JSON output mode (plain text is sufficient; `jq` can parse the source files if needed)
