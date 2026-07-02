# Disk trend projection — "fills in ~N days" warning
**Difficulty:** 3

## Goal
Add a new API endpoint that reads `.metrics.jsonl` and fits a linear slope to the last 48 hours of disk readings. When disk is above 75% and trending to fill within 30 days, surface a warning chip on the project card and a stat line on the detail page.

## Reason
The disk meter on each project card shows the current percentage, but gives no sense of trajectory. A disk that's at 80% and growing 0.5%/day needs attention in 40 days; one at 80% and growing 2%/day needs attention in 10 days. This context transforms a static number into actionable ops intelligence.

## Context

### API side
- `apps/api/src/routes/history.ts` already has metrics routes for `.metrics.jsonl`. Add a new route `/projects/:name/disk-trend` inside `historyRoutes`.
- Each `.metrics.jsonl` line has `{ t: number (unix sec), disk: number (0–100), ... }`.
- Read the last 48 hours of data (cutoff = `now - 48*3600`). Need at least 5 data points to compute a meaningful slope; return `null` slope if insufficient data.
- Compute slope via simple linear regression on `(t, disk)` pairs. Slope unit: `pct per second`. Convert to `pctPerDay = slope * 86400`.
- `projectedDaysUntilFull`: if `pctPerDay <= 0` (stable or shrinking), return `null`. Otherwise `(100 - currentDisk) / pctPerDay`.
- Response shape: `{ disk: number; pctPerDay: number; projectedDaysUntilFull: number | null }`.
- Route guard: same `findProject` + 404 pattern as other routes. Use `readJsonl` helper already in the file.

### Client side
- New `api.ts` function: `getDiskTrend(name): Promise<{ disk: number; pctPerDay: number; projectedDaysUntilFull: number | null } | null>` — returns `null` on 404 (project not found) or if insufficient data.
- New hook: `apps/dashboard/src/lib/use-disk-trend.ts` — fetches on mount, returns the trend object. Poll interval: 5 minutes (disk changes slowly).
- **Project card** (`apps/dashboard/src/components/project-card.tsx`): call `useDiskTrend(name)`. If `projectedDaysUntilFull !== null && projectedDaysUntilFull <= 30 && disk > 75`, render a chip in the badge row: `disk full ~{Math.round(projectedDaysUntilFull)}d` with amber color (`var(--warn, #e5a00d)`).
- **Detail page** (`apps/dashboard/app/projects/[name]/page.tsx`): call `useDiskTrend(name)`. If trending, show a one-line stat below the disk meter or inside `HealthCard`: `Disk trending: +${pctPerDay.toFixed(1)}%/day · full in ~${days}d`.

### Linear regression helper
Simple least-squares slope: given points `[(x1,y1)...(xn,yn)]`, `slope = (n*Σxy - Σx*Σy) / (n*Σx² - (Σx)²)`. Implement inline in the route handler or extract to `apps/api/src/lib/math.ts`.

## Tasks
1. Add `/projects/:name/disk-trend` GET route in `apps/api/src/routes/history.ts`.
2. Implement linear regression on last-48h disk readings; return JSON with `disk`, `pctPerDay`, `projectedDaysUntilFull`.
3. Add `getDiskTrend` to `apps/dashboard/src/lib/api.ts`.
4. Create `apps/dashboard/src/lib/use-disk-trend.ts`.
5. In `project-card.tsx`, call `useDiskTrend` and render warning chip when conditions met.
6. In `[name]/page.tsx`, call `useDiskTrend` and render trend stat in the health section.

## Files involved
- `apps/api/src/routes/history.ts` — new disk-trend route
- `apps/dashboard/src/lib/api.ts` — new `getDiskTrend` function
- `apps/dashboard/src/lib/use-disk-trend.ts` — new hook
- `apps/dashboard/src/components/project-card.tsx` — disk trend chip
- `apps/dashboard/app/projects/[name]/page.tsx` — disk trend stat line

## Acceptance criteria
- [x] `/projects/:name/disk-trend` returns correct JSON for a project with metrics history
- [x] Returns `projectedDaysUntilFull: null` when disk is stable or shrinking
- [x] Project card shows amber chip when disk >75% and fills in <30 days
- [x] Project card shows nothing new when disk is stable or <75%
- [x] Detail page shows trend stat when applicable
- [x] `pnpm typecheck` passes

## Completed

**Date:** 2026-06-20

### Summary
Added a `/projects/:name/disk-trend` API route that reads the last 48h of `.metrics.jsonl`, runs simple least-squares linear regression on `(t, disk)` pairs, and returns `{ disk, pctPerDay, projectedDaysUntilFull }`. Returns early with `null` projected days if fewer than 5 data points or if slope is ≤ 0. The regression uses summed accumulators in a single pass for efficiency.

On the client, `DiskTrend` type and `getDiskTrend` fetch function were added to `api.ts`, and a `useDiskTrend` hook polls every 5 minutes. The project card shows an amber "disk full ~Nd" chip when disk > 75% and projected full < 30 days. The detail page shows a one-line stat banner with the daily rate and projected days.

### Files changed
- `apps/api/src/routes/history.ts` — new `/projects/:name/disk-trend` GET route with linear regression
- `apps/dashboard/src/lib/api.ts` — `DiskTrend` interface + `getDiskTrend` function
- (new) `apps/dashboard/src/lib/use-disk-trend.ts` — hook polling disk trend every 5 min
- `apps/dashboard/src/components/project-card.tsx` — imports hook, renders amber chip when threshold met
- `apps/dashboard/app/projects/[name]/page.tsx` — imports hook, renders trend stat banner after HealthCard

### Verification
- `pnpm typecheck` (dashboard): clean
- `pnpm typecheck` (api): clean

### Follow-ups
- `[defer]` The detail page shows the trend banner only when disk > 75% (matches the card chip threshold). Could show a dimmer informational stat at lower levels if desired.
- `[defer]` The regression uses only the last 48h window. If a project has bursty disk usage, the slope could be misleading. A longer window (7 days) would smooth it — can adjust the cutoff constant in the route if needed.

## Out of scope
- Memory or CPU trend projections
- Email/push alerts for disk warnings (separate concern)
- Historical trend chart (just the chip for now)
