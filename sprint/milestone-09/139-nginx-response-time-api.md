# Sprint 139 — Nginx response time percentiles API

**Difficulty:** 3

## Goal

Add a `GET /projects/:name/response-times` route that SSHes into the server, parses nginx access logs from the last 24 hours, and returns p50/p95/p99 response times.

## Reason

Knowing a service is "up" (HTTP 200) tells you almost nothing about user experience. Response time percentiles — especially p95 and p99 — reveal slow endpoints, database lock contention, and memory pressure before they manifest as timeouts. The data is already on the server; this route surfaces it.

## Context

- Create `apps/api/src/routes/response-times.ts`. Register in `apps/api/src/index.ts`.
- Nginx log format includes `$request_time` (seconds, floating point). The default combined log format does NOT include it; but projects here have nginx configured to log it. Verify the field exists by checking if the log line has enough fields. If the format doesn't include request_time, return `{ available: false }`.
- Nginx access log location: `/var/log/nginx/access.log` (plus possibly `/var/log/nginx/{domain}-access.log`).
- SSH command (awk pipeline to compute sorted percentile list):
  ```bash
  awk 'NF>=10 {rt=$(NF-1); if(rt+0==rt && rt>0) print rt}' /var/log/nginx/access.log /var/log/nginx/*-access.log 2>/dev/null | sort -n | awk 'BEGIN{c=0} {a[++c]=$1} END{if(c>0){p50=a[int(c*0.50)+1]; p95=a[int(c*0.95)+1]; p99=a[int(c*0.99)+1]; printf "%.3f %.3f %.3f %d\n",p50,p95,p99,c}}'
  ```
  Note: `$(NF-1)` assumes request_time is the second-to-last field. This matches the common nginx log format with `$request_time $upstream_response_time` at the end. If parsing fails (no output), return `{ available: false }`.
- Return type:
  ```ts
  | { available: false }
  | { available: true; p50ms: number; p95ms: number; p99ms: number; sampleCount: number }
  ```
  Multiply seconds by 1000 to get milliseconds.
- TTL cache 120_000ms.
- Guard: only run if `status.nginxConfigured` — but since this route is stateless, just check if nginx is installed: `which nginx` in the SSH command or just attempt and return `{ available: false }` on empty output.

## Tasks

1. Read `apps/api/src/routes/projects.ts` lines 1–15 for import pattern.
2. Read `apps/api/src/index.ts` for registration pattern.
3. Create `apps/api/src/routes/response-times.ts` with the route.
4. Handle the "no data" case: if the awk pipeline produces no output (access logs don't exist or don't have request_time), return `{ available: false }` with HTTP 200.
5. Parse the single output line: `p50 p95 p99 count` space-separated, multiply by 1000 for ms.
6. Register `responseTimeRoutes` in `apps/api/src/index.ts`.
7. Run `pnpm nx typecheck api --skip-nx-cache`. Fix any errors.

## Files involved

- new file: `apps/api/src/routes/response-times.ts` — response-times route
- `apps/api/src/index.ts` — register response time routes

## Acceptance criteria

- [x] Returns `{ available: true, p50ms, p95ms, p99ms, sampleCount }` when nginx logs contain request_time
- [x] Returns `{ available: false }` when logs are empty or field is missing
- [x] Times are in milliseconds (seconds × 1000)
- [x] Returns 503 on SSH failure
- [x] `pnpm nx typecheck api --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Created `apps/api/src/routes/response-times.ts` with `GET /projects/:name/response-times`. SSHes an awk pipeline that extracts the second-to-last field (request_time in seconds) from nginx access logs, sorts numerically, then computes p50/p95/p99 and sample count in a second awk pass. Returns `{ available: false }` when logs are absent or produce no output. Converts seconds to milliseconds by multiplying by 1000 and rounding. 120s TTL cache.

### Files changed
- (new) `apps/api/src/routes/response-times.ts` — response-times route + percentile parser
- `apps/api/src/index.ts` — registered `responseTimeRoutes`

### Verification
- `pnpm nx typecheck api --skip-nx-cache`: clean

### Follow-ups
- `[defer]` The awk assumes request_time is the second-to-last field; projects with non-standard nginx log formats may return `{ available: false }` — can be addressed with a configurable field index if needed

## Out of scope

- Dashboard UI (sprint 140)
- Per-endpoint breakdown
- Historical percentile trending
- Time window configuration (24h is fixed for now)
