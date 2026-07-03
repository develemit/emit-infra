# Sprint 156 — Deploy cadence chart

> _Promoted from observability expansion plan, 2026-07-01._

**Difficulty:** 2

## Goal

Add a `GET /projects/:name/deploy-cadence` API route that groups `.deploy-history.jsonl` entries by calendar day, then render a 30-day SVG bar chart in the project detail page showing deploys-per-day with failure highlighting.

## Reason

The existing deploy timeline shows individual deploys but makes it hard to spot cadence — "we went 10 days without shipping" or "we had 6 hotfixes in one day." A bar chart makes that pattern immediately visible without counting rows.

## Context

- `.deploy-history.jsonl` lives at `~/projects/<name>/.deploy-history.jsonl`. Each entry is `DeployHistoryEntry`: `{ status, sha, branch, startedAt: string (ISO), completedAt, durationSec, servicesBuilt, message? }`.
- `startedAt` is an ISO datetime string — parse with `new Date(entry.startedAt)` and extract `YYYY-MM-DD`.
- Existing route in `apps/api/src/routes/history.ts` provides `GET /projects/:name/deploy-history`. The new cadence route lives in the same file (same `historyRoutes` function).
- `readJsonl<T>(filePath, filter?)` from `'../lib/jsonl.js'` reads a JSONL file.
- Dashboard pattern: add type + fetch fn to `apps/dashboard/src/lib/api.ts`, then a standalone chart component.
- The `QueueChart` component at `apps/dashboard/src/components/detail/queue-chart.tsx` is the clearest SVG chart example — read it for style reference.
- Mount the new chart in `apps/dashboard/app/projects/[name]/page.tsx` in the same section as `DeployTimeline`.

## Tasks

1. In `apps/api/src/routes/history.ts`, add `GET /projects/:name/deploy-cadence`:
   - Read all `.deploy-history.jsonl` entries.
   - Bucket by `YYYY-MM-DD` using `new Date(entry.startedAt).toISOString().slice(0, 10)`.
   - Fill in every day for the last 30 days (even days with 0 deploys).
   - Return `{ days: Array<{ date: string; total: number; failures: number }> }` sorted ascending by date.
2. In `apps/dashboard/src/lib/api.ts`, add:
   - Interface `DeployCadenceDay { date: string; total: number; failures: number }`
   - `async function getDeployCadence(name: string): Promise<DeployCadenceDay[]>` — fetches the route, returns `body.days`.
3. Create `apps/dashboard/src/components/detail/deploy-cadence-chart.tsx`:
   - Props: `{ days: DeployCadenceDay[] }`.
   - SVG bar chart: each day is a bar, height proportional to `total`, failures shown as a red segment at the top of each bar, x-axis dates (show every 7th).
   - Dim gray bars for success, red overlay for failures.
   - Show a "No deploy history" empty state if `days.every(d => d.total === 0)`.
4. In `apps/dashboard/app/projects/[name]/page.tsx`, fetch `getDeployCadence(name)` with `useEffect` + local state, render `<DeployCadenceChart days={cadenceDays} />` near `<DeployTimeline>`.
5. Run `pnpm nx typecheck dashboard --skip-nx-cache && pnpm nx typecheck api --skip-nx-cache`.

## Files involved

- `apps/api/src/routes/history.ts` — add `GET /projects/:name/deploy-cadence` inside `historyRoutes`
- `apps/dashboard/src/lib/api.ts` — add `DeployCadenceDay` interface and `getDeployCadence`
- (new) `apps/dashboard/src/components/detail/deploy-cadence-chart.tsx` — SVG bar chart component
- `apps/dashboard/app/projects/[name]/page.tsx` — fetch cadence data + mount chart

## Acceptance criteria

- [x] `GET /projects/:name/deploy-cadence` returns 30 days of data with correct `total` and `failures` counts
- [x] Days with zero deploys are included (filled gaps)
- [x] Chart renders bars with red failure segments when failures > 0
- [x] Empty state shows when no deploys in the last 30 days
- [x] Both typechecks pass clean

## Completed

**Date:** 2026-07-02

### Summary
Added `GET /projects/:name/deploy-cadence` to `historyRoutes` in `history.ts`. The route reads `.deploy-history.jsonl`, buckets entries by `YYYY-MM-DD`, fills in every day for the last 30 days, and returns ascending-sorted `{ days }`. Failures are counted by checking `status !== 'success'`. Created `DeployCadenceChart` — an SVG bar chart that renders stacked rect elements (success in `var(--fg-muted)`, failures in `var(--err)`) and date labels every 7th day. Mounted the chart above `DeployTimeline` in the project detail page, fetched via a `useEffect` → local state pattern.

### Files changed
- `apps/api/src/routes/history.ts` — added `GET /projects/:name/deploy-cadence`
- `apps/dashboard/src/lib/api.ts` — added `DeployCadenceDay` interface and `getDeployCadence`
- (new) `apps/dashboard/src/components/detail/deploy-cadence-chart.tsx` — SVG bar chart component
- `apps/dashboard/app/projects/[name]/page.tsx` — import, state, useEffect, and mount

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean
- `pnpm nx typecheck api --skip-nx-cache`: clean

### Follow-ups
- none

## Out of scope

- Range selector (always 30 days for now)
- Clicking a bar to filter the deploy timeline
- Branches filter
