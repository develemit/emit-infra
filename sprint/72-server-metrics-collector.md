# Server-side metrics collector with JSONL storage
**Difficulty:** 3

## Goal
A lightweight script runs every 5 minutes, SSHes to each registered project's server, collects system and container metrics, and appends them to a local JSONL file per project. This replaces the browser-only localStorage metric collection with a durable, always-on backend.

## Reason
The current `useMetricHistory` hook stores mem/disk readings in the browser's localStorage — data is lost when you switch browsers, only accumulates while the tab is open, and is limited to 2 metrics (memory %, disk %). To detect "this deploy caused a CPU spike 3 hours ago" you need server-side collection that runs independently of the dashboard being open, with richer metrics including CPU, network I/O, and per-container stats.

## Context
- The API already SSHes to servers for live status via `sshExec` from `@emit-infra/core` (see `apps/api/src/routes/projects.ts` line 119). The collector can use the same SSH key discovery.
- Project configs live at `~/projects/<name>/.emit-infra.json` with `serverIp`, `domain`, and `sshKeyName` fields.
- SSH keys are at `~/.ssh/<sshKeyName>`.
- The existing `StatusData` collects uptime, disk %, memory %, container count — the collector adds CPU %, network bytes, and per-container breakdown.
- The weekly `ghcr-prune.sh` is scheduled via launchd — use the same pattern for the collector.
- Metric files go in each project dir: `~/projects/<name>/.metrics.jsonl`.
- Builds on sprint 71 (history log) only in that both produce JSONL files the API will serve — no code dependency.

## Tasks
1. Create `scripts/collect-metrics.sh` that:
   - Discovers all registered projects by scanning `~/projects/*/.emit-infra.json`
   - For each project with a `serverIp` or `domain`, SSHes and runs a single compound command that outputs:
     - CPU % (from `/proc/stat` or `top -bn1`)
     - Memory % and absolute values (from `free -m`)
     - Disk % and absolute values (from `df -h /`)
     - Network bytes rx/tx (from `/proc/net/dev`, primary interface)
     - Per-container: name, CPU %, memory usage, restart count (from `docker stats --no-stream` + `docker inspect`)
   - Parses the SSH output into a JSON object
   - Appends one line to `~/projects/<name>/.metrics.jsonl`
2. Each JSONL line shape:
   ```json
   {
     "t": 1750000000,
     "cpu": 23,
     "mem": 45, "memUsedMb": 920, "memTotalMb": 2048,
     "disk": 62, "diskUsedGb": "12.4", "diskTotalGb": "20.0",
     "netRxBytes": 123456789, "netTxBytes": 987654321,
     "containers": [
       {"name": "api", "cpu": 5.2, "memMb": 180, "restarts": 0},
       {"name": "web", "cpu": 1.1, "memMb": 95, "restarts": 0}
     ]
   }
   ```
3. Add a size guard: if `.metrics.jsonl` exceeds 10000 lines (~35 days at 5min intervals), truncate to the newest 8640 (30 days).
4. Add a launchd plist `com.emit.metrics-collector.plist` to `~/Library/LaunchAgents/` that runs every 5 minutes. Same pattern as the existing `com.emit.ghcr-prune.plist`.
5. Handle failures gracefully: if a server is unreachable, log the error and skip (don't crash the entire collection run). Append a `{"t": ..., "error": "unreachable"}` entry so gaps are visible.
6. Verify with `bash -n`, then do a manual test run and confirm JSONL output.

## Files involved
- new file: `scripts/collect-metrics.sh` — the collector script
- new file: `~/Library/LaunchAgents/com.emit.metrics-collector.plist` — launchd schedule
- `scripts/lib/ci-utils.sh` — no changes, but referenced for pattern consistency
- `~/projects/<each>/.metrics.jsonl` — created automatically on first collection

## Acceptance criteria
- [x] Script discovers projects from `.emit-infra.json` files automatically
- [x] Collects CPU, memory, disk, network, and per-container stats via SSH
- [x] Appends valid JSON lines to `.metrics.jsonl` per project
- [x] Unreachable servers get an error entry, don't crash the run
- [x] Auto-truncates at 10000 lines
- [x] launchd plist installed and loaded (every 5 minutes)
- [x] `bash -n` passes
- [x] Commit to emit-infra

## Out of scope
- API routes to serve metrics (sprint 73)
- Dashboard visualization (sprints 74-75)
- Alerting on thresholds (future initiative)

## Completed

**Date:** 2026-06-18

### Summary
Created `scripts/collect-metrics.sh` — a server-side metrics collector that discovers projects from `~/projects/*/.emit-infra.json`, SSHes to each server, and collects CPU %, memory (% and absolute), disk (% and absolute), network I/O bytes, and per-container stats (name, CPU %, memory MB, restart count). The remote script samples `/proc/stat` twice with a 1-second gap for CPU, uses `free -m` for memory, `df -BG /` for disk, `/proc/net/dev` for network, and `docker stats --no-stream` + `docker inspect` for containers. Results append as one JSON line per project to `.metrics.jsonl`. Unreachable servers get an `{"error":"unreachable"}` entry so gaps are visible. Files auto-truncate at 10,000 lines (keeping newest 8,640 = 30 days at 5-min intervals).

A launchd plist at `~/Library/LaunchAgents/com.emit.metrics-collector.plist` runs the script every 5 minutes.

### Files changed
- (new) `scripts/collect-metrics.sh` — metrics collector script
- (new) `~/Library/LaunchAgents/com.emit.metrics-collector.plist` — launchd schedule (every 5 minutes)

### Verification
- `bash -n`: clean
- Live test: 3/5 servers collected successfully (develemail, diner-decider, emit-vision), 2 unreachable (martialops, tastease — graceful error entries), 1 skipped (test-smoke — no sshKeyName)
- JSON validation: all entries pass `python3 -m json.tool`
- Container names: correctly extracted (web, api, worker, postgres, clickhouse, etc.)
- launchd: loaded and running (`launchctl list` confirms)

### Follow-ups
- [defer] martialops and tastease are unreachable via domain — may need `serverIp` added to their `.emit-infra.json` configs once DNS or firewall is resolved
- [defer] emit-vision has two containers both named "backup" (pg-backup and ch-backup share the suffix) — could disambiguate with a longer name extraction if needed
