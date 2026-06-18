# API routes for metrics history, deploy history, and CI history
**Difficulty:** 3

## Goal
The emit-infra API serves historical metrics, deploy events, and CI events per project from the JSONL files created in sprints 71-72. The dashboard can query any time range and get downsampled data suitable for charting.

## Reason
Sprints 71 and 72 create the data (deploy/CI history and server metrics). This sprint makes that data accessible to the dashboard over HTTP. Without these routes, the dashboard can't show historical charts or deploy timelines — it would be stuck with the live-only status polling it has today.

## Context
- Builds on sprint 71 (`.deploy-history.jsonl`, `.ci-history.jsonl`) and sprint 72 (`.metrics.jsonl`).
- All JSONL files live at `~/projects/<name>/.<type>.jsonl`.
- Existing routes are in `apps/api/src/routes/projects.ts` — already has `/projects/:name/ci-status` and `/projects/:name/deploy-status` for point-in-time reads.
- The API uses Fastify with typed params/querystring.
- Types should go in `apps/api/src/lib/` or inline — follow existing patterns.
- For metrics, downsampling is important: 30 days of 5-min data = ~8640 points. The API should return at most ~500 points per request, averaging adjacent points when the window is large.

## Tasks
1. Add `GET /projects/:name/metrics` with querystring `{ hours?: number }` (default 24, max 720 = 30 days):
   - Read `.metrics.jsonl`, filter to the requested time window
   - Downsample to max 500 points using simple averaging of adjacent buckets
   - Return `{ points: MetricPoint[], range: { from: number, to: number } }`
   - MetricPoint shape: `{ t, cpu, mem, disk, netRxBytes, netTxBytes, containers }`
2. Add `GET /projects/:name/deploy-history` with querystring `{ limit?: number }` (default 50, max 200):
   - Read `.deploy-history.jsonl`, return the newest `limit` entries in reverse chronological order
   - Return `{ deploys: DeployHistoryEntry[] }`
   - DeployHistoryEntry shape: `{ status, sha, branch, startedAt, completedAt, durationSec, servicesBuilt }`
3. Add `GET /projects/:name/ci-history` with querystring `{ limit?: number }` (default 50, max 200):
   - Read `.ci-history.jsonl`, return newest entries
   - Return `{ runs: CiHistoryEntry[] }`
   - CiHistoryEntry shape: `{ status, sha, branch, startedAt, completedAt, durationSec }`
4. Create a shared `readJsonl<T>(filePath, filterFn?)` utility in `apps/api/src/lib/jsonl.ts` to avoid duplicating file-read + parse + filter logic.
5. Add TypeScript types for all response shapes in `apps/api/src/lib/types.ts` or co-located.
6. Add corresponding client-side fetch functions and types in `apps/dashboard/src/lib/api.ts`:
   - `getMetrics(name, hours?)` → `MetricsResponse`
   - `getDeployHistory(name, limit?)` → `DeployHistoryResponse`
   - `getCiHistory(name, limit?)` → `CiHistoryResponse`
7. Handle missing JSONL files gracefully (return empty arrays, not 404).

## Files involved
- `apps/api/src/routes/projects.ts` — add 3 new route handlers
- new file: `apps/api/src/lib/jsonl.ts` — shared JSONL reader with filtering and downsampling
- `apps/dashboard/src/lib/api.ts` — add fetch functions and types for history endpoints

## Acceptance criteria
- [x] `GET /projects/:name/metrics?hours=24` returns downsampled metric points
- [x] `GET /projects/:name/deploy-history` returns deploy events newest-first
- [x] `GET /projects/:name/ci-history` returns CI events newest-first
- [x] Missing JSONL files return empty arrays (not errors)
- [x] Metrics are downsampled to max 500 points regardless of time range
- [x] Dashboard `api.ts` has typed fetch functions for all 3 endpoints
- [x] Typecheck and lint pass

## Out of scope
- Dashboard UI rendering of charts (sprints 74-75)
- Real-time metric streaming / WebSocket push
- Aggregation across projects (per-project only for now)

## Completed

**Date:** 2026-06-18

### Summary
Added three history API routes to serve JSONL data from sprints 71-72. Created a dedicated `history.ts` route file (rather than appending to the 270-line `projects.ts`) with `GET /projects/:name/metrics`, `/deploy-history`, and `/ci-history`. The metrics route supports a configurable `hours` querystring (1-720, default 24) with downsampling to max 500 points using bucket averaging. Deploy and CI history routes return newest-first with configurable `limit` (1-200, default 50). A shared `readJsonl<T>()` utility in `apps/api/src/lib/jsonl.ts` handles file reading, JSON parsing, and optional filtering. Missing JSONL files return empty arrays. Dashboard `api.ts` has typed fetch functions (`getMetrics`, `getDeployHistory`, `getCiHistory`) with full response type interfaces.

### Files changed
- (new) `apps/api/src/lib/jsonl.ts` — generic JSONL reader with `readJsonl<T>()` and `downsample()` utility
- (new) `apps/api/src/routes/history.ts` — three history routes (metrics, deploy-history, ci-history)
- `apps/api/src/index.ts` — registered `historyRoutes`
- `apps/dashboard/src/lib/api.ts` — added types (MetricPoint, DeployHistoryEntry, CiHistoryEntry, response types) and fetch functions

### Verification
- `pnpm nx run api:typecheck`: clean
- `pnpm nx run dashboard:typecheck`: clean
- Lint on changed files: clean (pre-existing errors in billing.ts and vitest.config.ts are unrelated)
- Live test via tsx: all 3 routes return correct data shapes, missing files return empty arrays, unknown projects return 404

### Follow-ups
none
