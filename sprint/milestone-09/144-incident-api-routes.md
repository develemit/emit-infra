# Sprint 144 — Incident API routes

**Difficulty:** 2

## Goal

Add `GET /projects/:name/incidents` to `apps/api/src/routes/history.ts` that reads `.incidents.jsonl`, pairs up→down + down→up transitions into resolved incidents with durations, and returns a list plus MTTR.

## Reason

Sprint 143 writes raw transition events; this sprint turns them into structured incidents that the dashboard and any future alerting can consume. Computing duration and MTTR in the API keeps the UI simple.

## Context

- Builds on sprint 143: `.incidents.jsonl` exists with lines of shape `{ type, projectName, event, t }`.
- Add the route inside the existing `historyRoutes` in `apps/api/src/routes/history.ts` — same file, same pattern as other routes there (`readJsonl` is already imported).
- Pairing algorithm (SSH probes only for now — HTTP incidents are secondary):
  1. Read all records for the project, filter `type === 'ssh'`.
  2. Walk chronologically. Track `openDownAt: number | null`.
  3. On `event === 'down'`: if no open incident, set `openDownAt = t`.
  4. On `event === 'up'`: if `openDownAt` is set, emit `{ startedAt, resolvedAt: t, durationSec: t - openDownAt, resolved: true }`, reset `openDownAt`.
  5. If `openDownAt` is still set at the end of the file, emit `{ startedAt: openDownAt, resolvedAt: null, durationSec: null, resolved: false }`.
- Compute MTTR: mean of `durationSec` for all resolved incidents. `null` if no resolved incidents.
- Return type:
  ```ts
  {
    incidents: {
      startedAt: number      // unix seconds
      resolvedAt: number | null
      durationSec: number | null
      resolved: boolean
    }[]
    mttrSec: number | null
  }
  ```
  Most recent first.
- Limit to last 90 days by default (query param `days`, max 365).

## Tasks

1. Read `apps/api/src/routes/history.ts` lines 1–60 to understand the existing import style and `readJsonl` usage.
2. Add the `GET /projects/:name/incidents` route inside `historyRoutes`.
3. Implement the pairing algorithm. Keep it as a pure helper function at the top of the route body or as an inline function.
4. Run `pnpm nx typecheck api --skip-nx-cache`. Fix any errors.

## Files involved

- `apps/api/src/routes/history.ts` — add incidents route inside `historyRoutes`

## Acceptance criteria

- [x] `GET /projects/:name/incidents` returns `{ incidents: [...], mttrSec }` most recent first
- [x] Resolved incidents have `durationSec` set; unresolved have `durationSec: null` and `resolved: false`
- [x] MTTR is the mean of resolved incident durations, or `null` if none
- [x] Returns `{ incidents: [], mttrSec: null }` when `.incidents.jsonl` does not exist
- [x] `pnpm nx typecheck api --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Added `GET /projects/:name/incidents` inside `historyRoutes` in `history.ts`. Added `DaysQuery` validator (1–365, default 90), `IncidentRecord` and `Incident` interfaces. Reads `.incidents.jsonl` via `readJsonl` with cutoff filter, pairs SSH `down`/`up` events using a state-machine walk, emits resolved incidents with `durationSec` and unresolved ones with `null`. Computes MTTR as mean of resolved durations. Returns most recent first.

### Files changed
- `apps/api/src/routes/history.ts` — added `DaysQuery`, `IncidentRecord`, `Incident`, and `GET /projects/:name/incidents` route

### Verification
- `pnpm nx typecheck api --skip-nx-cache`: clean

### Follow-ups
none

## Out of scope

- Dashboard UI (sprint 145)
- HTTP probe incidents (secondary type — include in data if present but don't add separate pairing logic)
- Pagination beyond the `days` limit
