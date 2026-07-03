# Sprint 161 — Nginx top endpoints + error breakdown

> _Promoted from observability expansion plan, 2026-07-01._

**Difficulty:** 3

## Goal

Add `GET /projects/:name/nginx-endpoints` — an SSH route that runs two awk passes on the nginx access log to produce a ranked list of paths by request count with per-path error rate. Render the results in a new `NginxEndpointsPanel` component.

## Reason

The existing `ResponseTimePanel` shows aggregate P50/P95/P99 latency but gives no insight into *what* is being hit. Knowing that `GET /api/sync` accounts for 60% of traffic or that `POST /webhook` has a 30% 5xx rate changes the investigation path entirely.

## Context

- The existing response-times route (`apps/api/src/routes/response-times.ts`) is the model — read it in full. It SSHes an awk pipeline against `/var/log/nginx/access.log /var/log/nginx/*-access.log`. Replicate the same file targets and TTL pattern (TTL: 300_000ms).
- Default nginx log format: `$remote_addr - $remote_user [$time_local] "$request" $status $body_bytes_sent "$http_referer" "$http_user_agent"`. The `$request` field (field 7 in the combined log) is like `"GET /api/foo HTTP/1.1"`. Extract the path with `awk '{match($7, /^"([A-Z]+) ([^ ?]+)/, a); if (a[2]) print $9, a[2]}'` where field 9 is `$status`.
- Two-pass approach (combine into one SSH command with `&&`):
  1. All requests by path: `awk '{match($7, /"[A-Z]+ ([^ ?]+)/, a); if (a[1]) print a[1]}' ... | sort | uniq -c | sort -rn | head -20`
  2. Error requests (4xx/5xx) by path: `awk '$9 ~ /^[45]/ {match($7, /"[A-Z]+ ([^ ?]+)/, a); if (a[1]) print a[1]}' ... | sort | uniq -c | sort -rn | head -20`
  - Combine results in Node: merge the two maps by path, compute `errorRate = errors / total`.
- Return: `{ available: false }` if no access log found, else `{ available: true, endpoints: Array<{ path: string; requests: number; errors: number; errorRate: number }> }` sorted by `requests` descending.
- If the awk regex doesn't match (non-standard format), gracefully return `{ available: false }`.

## Tasks

1. Read `apps/api/src/routes/response-times.ts` in full to understand the SSH command pattern, TTL cache usage, and `available: false` fallback.
2. Create `apps/api/src/routes/nginx-endpoints.ts` with `nginxEndpointsRoutes(app)` exporting `GET /projects/:name/nginx-endpoints`:
   - SSH two-pass awk (combine with `&&` into a single `sshExec` call, separated by a clear delimiter like `---END1---`).
   - Parse the two result blocks into `total` map and `errors` map.
   - Merge into `endpoints[]`, sort by `requests` desc.
   - 400 on invalid name, 404 on project not found.
3. Register in `apps/api/src/index.ts`.
4. In `apps/dashboard/src/lib/api.ts`, add `NginxEndpoint`, `NginxEndpointsData`, and `getNginxEndpoints(name)`.
5. Create `apps/dashboard/src/components/detail/nginx-endpoints-panel.tsx`:
   - `{ available: false }` → subtle "nginx access log not available" message.
   - Table: path (mono, truncated) | requests | errors | error rate (colored red when >5%).
   - Cap at 10 rows; if >10 rows exist show the top 10 only.
6. Mount in `apps/dashboard/app/projects/[name]/page.tsx` near `ResponseTimePanel` (guarded by `status?.nginxStatus === 'active'`).
7. Run both typechecks.

## Files involved

- (new) `apps/api/src/routes/nginx-endpoints.ts` — two-pass awk route
- `apps/api/src/index.ts` — register `nginxEndpointsRoutes`
- `apps/dashboard/src/lib/api.ts` — types and fetch function
- (new) `apps/dashboard/src/components/detail/nginx-endpoints-panel.tsx` — table panel
- `apps/dashboard/app/projects/[name]/page.tsx` — fetch + mount

## Acceptance criteria

- [x] `GET /projects/:name/nginx-endpoints` returns ranked endpoint list with request counts and error counts
- [x] `{ available: false }` returned when nginx log is absent or awk yields no output
- [x] Error rate > 5% renders red in the panel
- [x] Panel is guarded by `nginxStatus === 'active'` in page.tsx
- [x] Both typechecks pass clean

## Completed

**Date:** 2026-07-02

### Summary
Created `nginx-endpoints.ts` with `GET /projects/:name/nginx-endpoints` (300s TTL). Runs a two-pass awk command (combined with `&&` and a `---END1---` delimiter) to count total requests and error requests (4xx/5xx) by path from nginx access logs. Merges results into `NginxEndpoint[]` sorted by requests descending; returns `{ available: false }` if delimiter not found or no output. Created `NginxEndpointsPanel` table component (max 10 rows, error rate > 5% in red). Mounted in page.tsx guarded by `nginxStatus === 'active'`, next to `ResponseTimePanel`.

### Files changed
- (new) `apps/api/src/routes/nginx-endpoints.ts` — two-pass awk nginx endpoints route
- `apps/api/src/index.ts` — register `nginxEndpointsRoutes`
- `apps/dashboard/src/lib/api.ts` — added `NginxEndpoint`, `NginxEndpointsData`, `getNginxEndpoints`
- (new) `apps/dashboard/src/components/detail/nginx-endpoints-panel.tsx` — table panel
- `apps/dashboard/app/projects/[name]/page.tsx` — import, state, useEffect, conditional mount

### Verification
- `pnpm nx typecheck api --skip-nx-cache`: clean
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean

### Follow-ups
- `[defer]` `apps/dashboard/src/lib/api.ts` is now 600+ lines (well over the 300-line target); should be split into domain-specific modules in a future sprint

## Out of scope

- Per-method breakdown (GET vs POST)
- Time-windowed filtering (always full log file for now)
- Sorting by error rate instead of request count
