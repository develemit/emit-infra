# Sprint 157 — Uptime SLA % panel

> _Promoted from observability expansion plan, 2026-07-01._

**Difficulty:** 2

## Goal

Add a `GET /projects/:name/sla` route that computes 7-day and 30-day uptime percentages from `.incidents.jsonl`, and render a small two-stat panel in the project detail page.

## Reason

The incident panel already shows individual incidents and MTTR, but the headline reliability number — "99.2% uptime last 30 days" — isn't surfaced anywhere. This is the first number anyone asks when evaluating service health and is directly derivable from data already being collected.

## Context

- `.incidents.jsonl` is written by `apps/api/src/lib/status-monitor.ts`. Each line is `{ type: 'ssh'|'http', projectName, event: 'down'|'up', t: number }` (Unix timestamp in seconds).
- The existing incidents route in `apps/api/src/routes/history.ts` (around line 274) already pairs down/up events into incidents with `startedAt` and `resolvedAt`. Read that logic — the SLA route can reuse the same pairing algorithm.
- Uptime calculation:
  - Window in seconds: 7 × 86400 = 604800 (7d), 30 × 86400 = 2592000 (30d).
  - Downtime = sum of resolved incident durations that overlap the window, clamped to window bounds.
  - Unresolved incidents: count from `startedAt` to `now`.
  - Uptime % = `(windowSec - downtimeSec) / windowSec * 100`, clamped 0–100, rounded to 2 decimal places.
  - If no incidents file: return `{ uptime7d: 100, uptime30d: 100 }` (assume clean).
- TTL: 120_000ms — incidents don't change mid-request.
- Dashboard: small two-stat tile (similar to `ResponseTimePanel`). Show as `"99.82%"` with color coding: ≥99.9% = ok/green, ≥99% = warn/yellow, <99% = err/red.
- Mount in `apps/dashboard/app/projects/[name]/page.tsx` near the incident panel.

## Tasks

1. In `apps/api/src/routes/history.ts`, add `GET /projects/:name/sla` inside `historyRoutes`:
   - Read `.incidents.jsonl`, pair down/up events using the same state-machine pattern as the incidents route.
   - Compute downtime for 7d and 30d windows.
   - Return `{ uptime7d: number; uptime30d: number }`.
   - Wrap in a TTL cache keyed by project name (120s).
2. In `apps/dashboard/src/lib/api.ts`, add:
   - `interface SlaData { uptime7d: number; uptime30d: number }`
   - `async function getSla(name: string): Promise<SlaData | null>`
3. Create `apps/dashboard/src/components/detail/sla-panel.tsx`:
   - Props: `{ sla: SlaData }`.
   - Two stat tiles: "7-day uptime" and "30-day uptime".
   - Color: `var(--ok)` ≥ 99.9%, `var(--warn)` ≥ 99%, `var(--err)` < 99%.
4. In `apps/dashboard/app/projects/[name]/page.tsx`, fetch `getSla(name)` with `useEffect` + local state. Mount `<SlaPanel sla={sla} />` near `<IncidentPanel>`.
5. Run `pnpm nx typecheck api --skip-nx-cache && pnpm nx typecheck dashboard --skip-nx-cache`.

## Files involved

- `apps/api/src/routes/history.ts` — add `GET /projects/:name/sla` inside `historyRoutes`
- `apps/dashboard/src/lib/api.ts` — add `SlaData` type and `getSla`
- (new) `apps/dashboard/src/components/detail/sla-panel.tsx` — two-stat uptime panel
- `apps/dashboard/app/projects/[name]/page.tsx` — fetch + mount

## Acceptance criteria

- [x] `GET /projects/:name/sla` returns correct 7d and 30d uptime percentages
- [x] No incidents → returns `{ uptime7d: 100, uptime30d: 100 }`
- [x] Partial (unresolved) incidents reduce the uptime correctly
- [x] Color coding: green ≥ 99.9%, yellow ≥ 99%, red < 99%
- [x] Both typechecks pass clean

## Completed

**Date:** 2026-07-02

### Summary
Added `GET /projects/:name/sla` to `historyRoutes`. The route reads `.incidents.jsonl`, filters to SSH records, pairs down/up events using the same state machine as the existing incidents route, and computes downtime overlap with 7d/30d windows (clamped, unresolved incidents run to `now`). TTL-cached at 120s. Created `SlaPanel` with color-coded two-stat tiles. Mounted conditionally in the project detail page before `<IncidentPanel>`.

### Files changed
- `apps/api/src/routes/history.ts` — added `/projects/:name/sla` route with TTL cache
- `apps/dashboard/src/lib/api.ts` — added `SlaData` interface and `getSla`
- (new) `apps/dashboard/src/components/detail/sla-panel.tsx` — two-stat uptime panel
- `apps/dashboard/app/projects/[name]/page.tsx` — import, state, useEffect, conditional mount

### Verification
- `pnpm nx typecheck api --skip-nx-cache`: clean
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean

### Follow-ups
- none

## Out of scope

- Per-type breakdown (SSH vs HTTP uptime separately)
- Custom window lengths
- SLA targets / alerting thresholds
