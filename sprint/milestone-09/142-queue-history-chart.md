# Sprint 142 — Queue history chart

**Difficulty:** 2

## Goal

Add a small sparkline chart on the project detail page showing queue depth (`queueWait`) and failure count (`queueFailed`) over the selected time range, rendered only when the project has a queue configured.

## Reason

Sprint 141 starts recording queue metrics to `.metrics.jsonl`. This sprint surfaces them as a chart — turning two numbers ("3 failed · 47 waiting") into a timeline that answers "is this getting worse?" without requiring a developer to correlate manual spot-checks.

## Context

- Builds on sprint 141: `.metrics.jsonl` lines now include `queueFailed` and `queueWait`. The existing `GET /projects/:name/metrics?hours=N` route already returns all `MetricPoint` fields, including the new queue ones.
- In `apps/dashboard/src/lib/use-server-metrics.ts` (or wherever `useServerMetrics` lives), the `serverPoints` already include these fields since `MetricPoint` was updated in sprint 141. Check what fields are already mapped through.
- Component: `apps/dashboard/src/components/detail/queue-chart.tsx`. Use the same SVG polyline pattern as `RestartSparkline` in `container-row.tsx`. Two lines:
  - `queueWait` — plotted in `var(--fg-muted)` (informational)
  - `queueFailed` — plotted in `var(--err)` (alert)
  - Normalize both series independently against their own max.
  - Width: full container (like ResourceChart), height: 60px.
  - No axes or labels — just the polylines with a small legend below: a colored dot + label for each series.
- Mount in `apps/dashboard/app/projects/[name]/page.tsx` after `NetworkChart`, before `ContainerTable`. Guard: `serverPoints.some(p => p.queueFailed != null)`.
- The `serverPoints` array is already available via `useProjectDetail` — no new API calls needed.

## Tasks

1. Read `apps/dashboard/src/lib/use-server-metrics.ts` to see what fields `serverPoints` currently exposes and confirm `queueFailed`/`queueWait` flow through.
2. If the fields are not mapped through `useServerMetrics`, add them.
3. Read `apps/dashboard/src/components/detail/container-row.tsx` lines 23–45 to confirm the SVG polyline pattern.
4. Create `apps/dashboard/src/components/detail/queue-chart.tsx`.
5. Mount `<QueueChart points={serverPoints} />` in `apps/dashboard/app/projects/[name]/page.tsx`, guarded by `serverPoints.some(p => p.queueFailed != null)`.
6. Run `pnpm nx typecheck dashboard --skip-nx-cache`. Fix any errors.

## Files involved

- `apps/dashboard/src/lib/use-server-metrics.ts` — confirm/add queueFailed/queueWait fields
- new file: `apps/dashboard/src/components/detail/queue-chart.tsx` — chart component
- `apps/dashboard/app/projects/[name]/page.tsx` — mount chart

## Acceptance criteria

- [x] Chart renders two polylines: queueWait (muted) and queueFailed (red)
- [x] Chart only rendered when `serverPoints` contains at least one point with non-null `queueFailed`
- [x] Legend below chart identifies each line by color + label
- [x] Chart respects the `rangeHours` selector already on the page
- [x] `pnpm nx typecheck dashboard --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Added `queueFailed?` and `queueWait?` to the dashboard's `MetricPoint` type in `api.ts`. Created `QueueChart` component with two independently-normalized SVG polylines (queueWait=muted, queueFailed=red) and a legend. Exposed `serverPoints` from `useProjectDetail` hook, then mounted `<QueueChart points={serverPoints} />` in page.tsx guarded by `serverPoints.some(p => p.queueFailed != null)`.

### Files changed
- `apps/dashboard/src/lib/api.ts` — added `queueFailed?` and `queueWait?` to `MetricPoint` type
- (new) `apps/dashboard/src/components/detail/queue-chart.tsx` — two-series queue sparkline
- `apps/dashboard/src/lib/use-project-detail.ts` — exposed `serverPoints` in return
- `apps/dashboard/app/projects/[name]/page.tsx` — mounted `QueueChart`

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean

### Follow-ups
none

## Out of scope

- Per-queue breakdown
- Interactive tooltips
- Y-axis labels or gridlines
