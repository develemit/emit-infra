# Sprint 162 — Resource scale nudge

> _Promoted from observability expansion plan, 2026-07-01._

**Difficulty:** 3

## Goal

Add a `GET /projects/:name/scale-advice` route that checks recent metric history for sustained high disk or memory usage, and if found returns the next Hetzner server tier with its price delta. Render a subtle chip in `HealthCard` when advice is available.

## Reason

A disk meter showing 87% is a point-in-time reading — it might be a one-off spike. A nudge that says "Memory has been above 80% for the last hour — consider upgrading from cx22 to cx32 (+€3/mo)" has much more signal: it's based on a trend, and it does the pricing lookup for you.

## Context

- Metric history lives in `~/projects/<name>/.metrics.jsonl`. Each point is a `MetricPoint` with at minimum `{ t: number, disk: number, memory: number }` (0–100 integers). The `readJsonl` helper is in `apps/api/src/routes/history.ts` (via import from `../lib/jsonl.js`).
- Hetzner pricing: `getServerTypeMonthlyPrice(serverType, region)` in `apps/api/src/lib/hetzner.ts` returns `number | null` (EUR/month). The existing Hetzner server-type progression (CX series) is: cx22 → cx32 → cx42 → cx52 (double RAM/CPU each step). Hard-code this ordered list.
- Algorithm:
  1. Read last 12 metric points (last ~1 hour at 5-min collection cadence).
  2. Check if at least 6 consecutive recent points have `disk >= 80` or `memory >= 80`.
  3. If yes: determine which resource is the issue (prefer `disk` if both, since disk can't be scaled just by resizing — note this in the response).
  4. Look up current tier price and next tier price via `getServerTypeMonthlyPrice`.
  5. Return `{ advice: null }` if no issue, else `{ advice: { resource: 'disk'|'memory', sustainedPct: number, currentTier: string, nextTier: string | null, currentEurMonth: number | null, nextEurMonth: number | null, deltaNoteHtml?: string } }`.
  - Note: disk high → resize helps only temporarily; include a `note: 'disk'` signal so the UI can say "Consider also pruning Docker images."
- TTL: 600_000ms (10 minutes).
- `project.config.serverType` and `project.config.region` provide the current tier info.
- Dashboard: in `apps/dashboard/src/components/detail/health-card.tsx`, fetch `getScaleAdvice(name)` in the detail page and pass it as a prop. Render a chip below the Server stat tile:
  ```
  [↑ cx32 +€3/mo] Memory at 84% for 1h
  ```
  Use `var(--warn)` color, small text, subtle border.

## Tasks

1. Read `apps/api/src/lib/hetzner.ts` to understand `getServerTypeMonthlyPrice` signature and the TTL cache it uses.
2. Read `apps/api/src/routes/history.ts` around line 89 to see how `readJsonl` is called for metric points.
3. Create `apps/api/src/routes/scale-advice.ts` with `scaleAdviceRoutes(app)`:
   - `GET /projects/:name/scale-advice`.
   - Read last 12 points from `.metrics.jsonl`.
   - Run the sustained-high check.
   - Call `getServerTypeMonthlyPrice` for current and next tiers.
   - Return structured advice or `{ advice: null }`.
4. Register in `apps/api/src/index.ts`.
5. In `apps/dashboard/src/lib/api.ts`, add `ScaleAdvice`, `ScaleAdviceResponse`, `getScaleAdvice(name)`.
6. In `apps/dashboard/app/projects/[name]/page.tsx`, fetch `getScaleAdvice(name)` and pass to `HealthCard`.
7. In `apps/dashboard/src/components/detail/health-card.tsx`, render the chip when `advice` is non-null.
8. Run both typechecks.

## Files involved

- (new) `apps/api/src/routes/scale-advice.ts` — scale advice route
- `apps/api/src/index.ts` — register route
- `apps/dashboard/src/lib/api.ts` — types and fetch function
- `apps/dashboard/app/projects/[name]/page.tsx` — fetch advice, pass to HealthCard
- `apps/dashboard/src/components/detail/health-card.tsx` — render the nudge chip

## Acceptance criteria

- [x] Returns `{ advice: null }` when disk and memory are below threshold or history is too short
- [x] Returns advice with current/next tier and prices when sustained high
- [x] Dashboard chip renders when advice is non-null, hidden when null
- [x] Disk-specific advice includes the "pruning" note
- [x] Both typechecks pass clean

## Completed

**Date:** 2026-07-02

### Summary
Created `scale-advice.ts` with `GET /projects/:name/scale-advice` (600s TTL). Reads last 12 metric points from `.metrics.jsonl`, checks for 6-of-12 consecutive points with disk ≥ 80% or memory ≥ 80% (disk takes priority), looks up current/next CX tier prices via `getServerTypeMonthlyPrice`, and returns `{ advice }`. Returns `{ advice: null }` when data is insufficient or below threshold. Added `ScaleAdvice` type + `getScaleAdvice` fetch to `api.ts`. Updated `HealthCard` to accept optional `scaleAdvice` prop and render a warn-colored chip below the meters. Disk advice includes the "prune Docker images" note. Fetched in page.tsx via `useEffect` and passed as prop.

### Files changed
- (new) `apps/api/src/routes/scale-advice.ts` — scale advice route
- `apps/api/src/index.ts` — register `scaleAdviceRoutes`
- `apps/dashboard/src/lib/api.ts` — added `ScaleAdvice` interface and `getScaleAdvice`
- `apps/dashboard/src/components/detail/health-card.tsx` — added `scaleAdvice` prop and chip rendering
- `apps/dashboard/app/projects/[name]/page.tsx` — import, state, useEffect, prop pass

### Verification
- `pnpm nx typecheck api --skip-nx-cache`: clean
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean

### Follow-ups
- none

## Out of scope

- Configurable thresholds (hardcode 80% and 6-of-12 points)
- Downscale recommendations
- Non-CX Hetzner series
