# Dashboard sparklines from server metrics + deploy markers on project cards
**Difficulty:** 3

## Goal
Project cards show CPU/memory/disk sparklines backed by the server-collected metrics API (instead of localStorage), with deploy timestamps rendered as vertical marker lines so you can visually correlate deploys with resource changes at a glance.

## Reason
The current sparklines in `ResourceChart` only show data collected while your browser tab is open (localStorage). Switching to the metrics API means sparklines reflect real server history even if you haven't had the dashboard open. Adding deploy markers directly answers the user's core question: "did this deploy cause a spike?"

## Context
- Builds on sprint 73 (API routes for metrics + deploy history).
- `apps/dashboard/src/components/detail/resource-chart.tsx` already renders SVG sparklines for mem/disk with a `MetricPoint` type (`{ t, mem, disk, up }`).
- `apps/dashboard/src/lib/metric-history.ts` has `useMetricHistory` which stores points in localStorage — this will be replaced with an API-backed hook.
- The existing `ResourceChart` uses hardcoded SVG dimensions (`W=368, H=54`) and a `toPoints()` helper that maps data to SVG polyline coordinates.
- The project card at `apps/dashboard/src/components/project-card.tsx` already imports and renders `ResourceChart` in the detail view.
- Deploy history from sprint 73: `getDeployHistory(name)` returns `{ deploys: [...] }` with `completedAt` timestamps.

## Tasks
1. Create a new hook `useServerMetrics(name: string, hours?: number)` in `apps/dashboard/src/lib/use-server-metrics.ts`:
   - Calls `getMetrics(name, hours)` on mount and every 60 seconds
   - Returns `{ points: MetricPoint[], loading: boolean }`
   - Map the API's `MetricPoint` (with `cpu` field) to the chart's expected shape
2. Create a new hook `useDeployMarkers(name: string)` in `apps/dashboard/src/lib/use-deploy-markers.ts`:
   - Calls `getDeployHistory(name, 20)` on mount and every 60 seconds
   - Returns `{ deploys: DeployHistoryEntry[] }`
3. Update `ResourceChart` to:
   - Accept a `cpu` line in addition to mem/disk (new color, add to legend)
   - Accept an optional `deploys` prop (array of deploy timestamps)
   - Render deploy markers as thin vertical lines at the correct x-position with a small deploy icon or dot at the top
   - Add the CPU sparkline as a third polyline with its own color
4. Update the project detail view to wire `useServerMetrics` and `useDeployMarkers` into `ResourceChart` instead of the old localStorage-based `useMetricHistory`.
5. Keep `useMetricHistory` as a fallback if the metrics API returns empty (no collector data yet) — don't delete it, just prefer server data when available.
6. Ensure the chart remains responsive and works on mobile (flex-wrap, percentage widths if needed).

## Files involved
- new file: `apps/dashboard/src/lib/use-server-metrics.ts` — API-backed metrics hook
- new file: `apps/dashboard/src/lib/use-deploy-markers.ts` — deploy history hook
- `apps/dashboard/src/components/detail/resource-chart.tsx` — add CPU line, deploy markers
- `apps/dashboard/src/components/project-card.tsx` — wire new hooks into the detail view
- `apps/dashboard/src/lib/metric-history.ts` — keep as fallback, no changes needed

## Acceptance criteria
- [x] Sparklines show CPU + memory + disk from server-collected metrics
- [x] Deploy markers appear as vertical lines at correct timestamps on the chart
- [x] Charts update every 60 seconds with fresh data
- [x] Falls back to localStorage metrics if server metrics are empty
- [x] Mobile-friendly layout preserved
- [x] Typecheck and lint pass

## Out of scope
- Full detail page with time range selector and per-container breakdown (sprint 75)
- Network bandwidth charts (sprint 75)
- CI history visualization (sprint 75)

## Completed

**Date:** 2026-06-18

### Summary
Replaced the localStorage-only sparklines with server-backed metrics from the API. Created `useServerMetrics` hook (polls `getMetrics` every 60s) and `useDeployMarkers` hook (polls `getDeployHistory` every 60s). Updated `ResourceChart` to accept a generic `ChartPoint` type with optional `cpu` field and a `deploys` prop for deploy markers. The chart now renders three polylines (CPU in amber, memory in accent blue, disk in faint gray) plus deploy markers as dashed cyan vertical lines with dot indicators. Falls back to localStorage metrics when server data has fewer than 2 points. The project detail page maps server metric timestamps from Unix seconds to milliseconds for consistent chart rendering.

### Files changed
- (new) `apps/dashboard/src/lib/use-server-metrics.ts` — hook that polls `/projects/:name/metrics` every 60s
- (new) `apps/dashboard/src/lib/use-deploy-markers.ts` — hook that polls `/projects/:name/deploy-history` every 60s
- `apps/dashboard/src/components/detail/resource-chart.tsx` — added CPU line, deploy markers, `ChartPoint`/`DeployMarker` types
- `apps/dashboard/app/projects/[name]/page.tsx` — wired new hooks, server→local fallback logic

### Verification
- `pnpm nx run dashboard:typecheck`: clean
- `pnpm nx run api:typecheck`: clean
- Lint on all changed files: clean

### Follow-ups
none
