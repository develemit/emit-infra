# Sprint 140 — Nginx response time panel

**Difficulty:** 2

## Goal

Add a stat panel on the project detail page showing nginx p50/p95/p99 response times for the last 24 hours, rendered only when nginx is active and response time data is available.

## Reason

Sprint 139 computes the percentiles; this sprint surfaces them. P95 and P99 are the numbers that matter most — a P95 of 4 seconds means 5% of users are waiting 4+ seconds, which rarely shows up in average metrics but is obvious here.

## Context

- Builds on sprint 139: `GET /projects/:name/response-times` returns `{ available: false } | { available: true, p50ms, p95ms, p99ms, sampleCount }`.
- Add `getResponseTimes(name)` to `apps/dashboard/src/lib/api.ts`.
- Component: `apps/dashboard/src/components/detail/response-time-panel.tsx`. Card with title "Response Times (24h)" and `activity` icon.
  - Three stat tiles (same `StatTile` pattern as `health-card.tsx`): P50, P95, P99.
  - Format: `${ms.toFixed(0)}ms` if < 1000ms, `${(ms/1000).toFixed(2)}s` if ≥ 1000ms.
  - Color P99: if > 2000ms → `var(--err)`, if > 500ms → `var(--warn, #e5a00d)`, else default.
  - Sample count as dim subtitle: `Based on N requests`.
  - If `available: false`: render nothing (panel returns null).
  - No refresh button — fetches once on mount (data changes slowly).
- Mount in `apps/dashboard/app/projects/[name]/page.tsx` immediately after `HealthCard`, before the disk trend chip. Guard: `status?.nginxStatus === 'active'`.
- Read `apps/dashboard/src/components/detail/health-card.tsx` lines 1–28 to see the `StatTile` component — copy it or import it if it's exported.

## Tasks

1. Read `apps/dashboard/src/components/detail/health-card.tsx` lines 1–30 to check if `StatTile` is exported.
2. Add `getResponseTimes(name: string)` and `ResponseTimes` type to `apps/dashboard/src/lib/api.ts`.
3. Create `apps/dashboard/src/components/detail/response-time-panel.tsx`. If `StatTile` is not exported from health-card, define a local minimal version inline.
4. Mount `<ResponseTimePanel name={name} />` in `apps/dashboard/app/projects/[name]/page.tsx` right after the `{project && status && (<HealthCard .../>)}` block, guarded by `status?.nginxStatus === 'active'`.
5. Run `pnpm nx typecheck dashboard --skip-nx-cache`. Fix any errors.

## Files involved

- `apps/dashboard/src/lib/api.ts` — add `ResponseTimes` type and `getResponseTimes`
- new file: `apps/dashboard/src/components/detail/response-time-panel.tsx` — panel component
- `apps/dashboard/app/projects/[name]/page.tsx` — mount panel

## Acceptance criteria

- [x] Panel renders P50, P95, P99 as three stat tiles when data is available
- [x] P99 colored red if > 2000ms, yellow if > 500ms
- [x] Sample count shown as dim subtitle
- [x] Panel not rendered when `available: false` or nginx is inactive
- [x] `pnpm nx typecheck dashboard --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Added `ResponseTimes` discriminated union type and `getResponseTimes()` fetch to `api.ts`. Created `ResponseTimePanel` with an inline `StatTile` component (not exported from health-card), three P50/P95/P99 tiles with `formatMs()` helper (ms below 1000, decimal seconds above), P99 coloring (red >2s, yellow >500ms), and sample count subtitle. Mounted after HealthCard in page.tsx guarded by `status?.nginxStatus === 'active'`.

### Files changed
- `apps/dashboard/src/lib/api.ts` — added `ResponseTimes` type and `getResponseTimes`
- (new) `apps/dashboard/src/components/detail/response-time-panel.tsx` — P50/P95/P99 stat panel
- `apps/dashboard/app/projects/[name]/page.tsx` — mounted `ResponseTimePanel`

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean

### Follow-ups
none

## Out of scope

- Per-endpoint breakdown
- Historical chart of percentiles over time
- Configurable time window
