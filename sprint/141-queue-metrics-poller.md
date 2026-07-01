# Sprint 141 — Queue metrics in server metrics poller

**Difficulty:** 3

## Goal

Extend `scripts/collect-metrics.sh` to collect `queueFailed` and `queueWait` counts (from Redis/Bull) at each poll interval and include them in each `.metrics.jsonl` line, so queue depth can be trended over time.

## Reason

The current health status route already reads queue stats live, but they're point-in-time only — nothing is persisted to history. When a queue backs up overnight, operators have no timeline showing when it started or how fast it grew. Adding these two fields to the metrics JSONL turns a one-shot reading into a durable trend.

## Context

- `scripts/collect-metrics.sh` — the shell script that runs every 5 minutes (via cron on the API server) and appends JSON lines to `~/projects/{name}/.metrics.jsonl`. Read this file first to understand the existing structure.
- The status route in `apps/api/src/routes/projects.ts` (around line 122) already runs this Redis eval command via SSH to get queue stats:
  ```bash
  docker compose exec -T redis timeout 5 redis-cli eval 'local f=0;local w=0;for _,k in ipairs(redis.call("KEYS","bull:*:failed")) do f=f+redis.call("LLEN",k) end;for _,k in ipairs(redis.call("KEYS","bull:*:wait")) do w=w+redis.call("LLEN",k) end;return tostring(f)..":"..tostring(w)' 0 2>/dev/null
  ```
  Output is `"<failed>:<wait>"` or empty string if Redis isn't running.
- In `collect-metrics.sh`, queue data should only be collected when Redis is detected (check for a running redis container with `docker compose ps --format '{{.Service}}' | grep -qi redis`). If Redis isn't running, write `null` for both fields.
- The JSON line schema in `.metrics.jsonl` is:
  ```json
  { "t": <unix_sec>, "cpu": <pct>, "mem": <pct>, "disk": <pct>, ..., "nginx4xx": <n>, "nginx5xx": <n>, "containers": [...] }
  ```
  Add `"queueFailed": <n_or_null>` and `"queueWait": <n_or_null>` to this line.
- The `MetricPoint` interface in `apps/api/src/routes/history.ts` defines the TypeScript type for these lines. Add `queueFailed?: number | null` and `queueWait?: number | null` to it so the history API can return them.

## Tasks

1. Read `scripts/collect-metrics.sh` in full to understand current structure and where the JSON line is assembled.
2. Find where the JSON line is written (likely a `printf` or `echo` with JSON). Identify all existing fields.
3. Add the Redis queue probe: detect Redis presence, run the eval command, parse `"<failed>:<wait>"` output, default to `null` if not available.
4. Insert `queueFailed` and `queueWait` fields (as numbers or `null`) into the JSON line assembled by the script.
5. Read `apps/api/src/routes/history.ts` lines 17–32 to find `MetricPoint`. Add `queueFailed?: number | null` and `queueWait?: number | null` to the interface.
6. Run `pnpm nx typecheck api --skip-nx-cache`. Fix any errors.

## Files involved

- `scripts/collect-metrics.sh` — add queue metric collection and JSON output fields
- `apps/api/src/routes/history.ts` — add queue fields to `MetricPoint` interface

## Acceptance criteria

- [x] `collect-metrics.sh` includes `queueFailed` and `queueWait` in the JSON line written to `.metrics.jsonl`
- [x] When Redis is not running, both fields are written as `null`
- [x] `MetricPoint` in `history.ts` includes `queueFailed?: number | null` and `queueWait?: number | null`
- [x] `pnpm nx typecheck api --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Extended `collect-metrics.sh` with a Redis queue probe appended to `REMOTE_SCRIPT`. Detects a running Redis container by name using `docker ps --filter`, then execs the Bull LLEN eval command to get total failed and wait counts. Uses `docker exec` (not `docker compose exec`) so the probe works without needing the compose project directory. Falls back to `null` for both fields when Redis isn't running. Added `QUEUEFAILED:%s QUEUEWAIT:%s` to the remote output format, parsing them in `collect_one()` and writing them to the JSON line. Also added `queueFailed?: number | null` and `queueWait?: number | null` to the `MetricPoint` interface in `history.ts`.

### Files changed
- `scripts/collect-metrics.sh` — Redis probe in REMOTE_SCRIPT, new parse vars, updated JSON printf
- `apps/api/src/routes/history.ts` — added `queueFailed` and `queueWait` to `MetricPoint`

### Verification
- `pnpm nx typecheck api --skip-nx-cache`: clean

### Follow-ups
- `[defer]` Uses `docker ps --filter name=redis` which matches any container with "redis" in the name; projects with non-standard container names may not be detected — can add config field for redis container name if needed

## Out of scope

- Dashboard chart (sprint 142)
- Per-queue breakdown (only totals here)
- Separate Bull queue names tracking
