# Sprint 62 — Extend MetricPoint with `up` field and wire through ResourceChart

## Goal

Extend the metric history data model to record whether the project was reachable
at each poll, so uptime percentage can be computed in later sprints.

## Context

`useMetricHistory` (`apps/dashboard/src/lib/metric-history.ts`) stores
`{ t, mem, disk }` in localStorage at 30s intervals over a 24h window.

`ResourceChart` (`apps/dashboard/src/components/detail/resource-chart.tsx`)
calls `useMetricHistory(name, mem, disk)` and renders the SVG chart.

The detail page (`apps/dashboard/app/projects/[name]/page.tsx`) already has the
full `ProjectStatus` object after each poll, which includes both `httpStatus`
and `error`. A project is "up" when `!status.error && status.httpStatus === 200`.

## Tasks

1. In `metric-history.ts`, add `up: boolean` to the `MetricPoint` type.
2. Update `useMetricHistory` to accept `up: boolean` as a fourth parameter and
   write it into each stored point.
3. Backfill existing stored points that lack the field by defaulting
   `up ?? true` when reading from localStorage (so old data doesn't break).
4. In the detail page (`app/projects/[name]/page.tsx`), derive `up` from
   `status`:
   ```ts
   const up = !!status && !status.error && status.httpStatus === 200
   ```
   Pass it to `<ResourceChart ... up={up} />`.
5. In `ResourceChart`, accept `up: boolean` in `Props` and forward it to
   `useMetricHistory(name, mem, disk, up)`.

## Acceptance criteria

- `MetricPoint` has `up: boolean`.
- New poll cycles write `up` into localStorage.
- Old points without `up` are read as `up: true` without error.
- TypeScript compiles clean (`pnpm exec tsc --noEmit` in `apps/dashboard`).
- No visual change to the chart (rendering uses this data in sprint 63).

## Completed

**Date:** 2026-06-15

### Summary
Added `up: boolean` to the `MetricPoint` type and threaded it through `useMetricHistory` as a fourth parameter (defaults to `true`). Existing localStorage points missing the field are backfilled with `up: true` on read so old data doesn't break. The detail page derives `up` from the polled status (`!!status && !status.error && status.httpStatus === 200`) and passes it down to `ResourceChart`, which forwards it to the hook. No visual change to the chart — this data layer exists to power the uptime % computation in sprint 63.

### Files changed
- `apps/dashboard/src/lib/metric-history.ts` — added `up` to `MetricPoint`, 4th param to `useMetricHistory`, backfill on hydrate, included in new points
- `apps/dashboard/src/components/detail/resource-chart.tsx` — added `up: boolean` to `Props`, forwarded to `useMetricHistory`
- `apps/dashboard/app/projects/[name]/page.tsx` — derived `up` from polled status, passed to `<ResourceChart>`

### Verification
- `pnpm exec tsc --noEmit` in `apps/dashboard`: clean

### Follow-ups

- none
